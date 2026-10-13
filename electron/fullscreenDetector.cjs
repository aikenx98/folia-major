// electron/fullscreenDetector.cjs
// 用 koffi 调 Windows user32.dll，判定"屏幕是否已被其他应用占据"。
//
// 做法：用 GetTopWindow + GetWindow(GW_HWNDNEXT) 遍历所有顶层窗口（不用回调），
// 收集它们覆盖的屏幕矩形，在屏幕上打采样网格，统计多少比例的点落在至少一个
// 其他窗口内。覆盖率 >= 阈值 → 判定为"被占据"。
//
// 只支持 Windows，其他平台返回 no-op。

'use strict';

const koffi = require('koffi');

const MONITOR_DEFAULTTONEAREST = 2;
const GW_HWNDNEXT = 2;

// 采样网格边长。20x20 = 400 个点。
const SAMPLE_GRID = 20;
// 覆盖率阈值：达到或超过这个比例就认为"屏幕被其他应用占据"。
const COVERAGE_THRESHOLD = 0.85;

// 系统窗口类名，这些不参与覆盖率计算。
// Aero Peek（任务栏悬停预览）和 Alt+Tab 也会创建顶层窗口，
// 它们不属于"应用占据屏幕"，必须从名单里排除，否则鼠标一悬停就会误触发暂停。
const EXCLUDED_CLASS_NAMES = new Set([
    // 系统 shell
    'Shell_TrayWnd',
    'Shell_SecondaryTrayWnd',
    'Progman',
    'WorkerW',
    'SHELLDLL_DefView',
    // UWP 外框
    'Windows.UI.Core.CoreWindow',
    'ApplicationFrameWindow',
    // Aero Peek / 任务栏悬停预览
    'TaskListThumbnailWnd',            // 任务栏图标悬停时的缩略图预览
    'TaskListOverlayWnd',              // 任务栏覆盖层
    'TaskSwitcherWnd',                 // Alt+Tab 切换器
    'XamlExplorerHostIslandWindow',    // Win11 任务栏/预览宿主
    'Xaml_WindowedPopupClass',         // Win11 弹出层
    // DWM / 合成相关
    'Dwm',
    'Windows.UI.Composition.DesktopWindowContentBridge',
]);

let lib = null;
let RECT = null;
let MONITORINFO = null;
let GetForegroundWindow = null;
let GetWindowRect = null;
let GetClassNameW = null;
let IsWindowVisible = null;
let IsIconic = null;
let MonitorFromWindow = null;
let GetMonitorInfoW = null;
let GetTopWindow = null;
let GetWindow = null;

const ensureLoaded = () => {
    if (lib) return true;
    try {
        lib = koffi.load('user32.dll');

        RECT = koffi.struct('RECT', {
            left: 'long',
            top: 'long',
            right: 'long',
            bottom: 'long',
        });

        MONITORINFO = koffi.struct('MONITORINFO', {
            cbSize: 'uint32',
            rcMonitor: RECT,
            rcWork: RECT,
            dwFlags: 'uint32',
        });

        GetForegroundWindow = lib.func('intptr_t GetForegroundWindow()');
        GetWindowRect = lib.func('bool GetWindowRect(intptr_t hWnd, _Out_ RECT* lpRect)');
        GetClassNameW = lib.func('int GetClassNameW(intptr_t hWnd, _Out_ wchar_t* lpClassName, int nMaxCount)');
        IsWindowVisible = lib.func('bool IsWindowVisible(intptr_t hWnd)');
        IsIconic = lib.func('bool IsIconic(intptr_t hWnd)');
        MonitorFromWindow = lib.func('intptr_t MonitorFromWindow(intptr_t hwnd, uint32 dwFlags)');
        GetMonitorInfoW = lib.func('bool GetMonitorInfoW(intptr_t hMonitor, _Inout_ MONITORINFO* lpmi)');
        GetTopWindow = lib.func('intptr_t GetTopWindow(intptr_t hWnd)');
        GetWindow = lib.func('intptr_t GetWindow(intptr_t hWnd, uint32 uCmd)');

        console.log('[FullscreenDetector] user32 加载成功');
        return true;
    } catch (error) {
        console.warn('[FullscreenDetector] koffi/user32 加载失败:', error && error.message);
        lib = null;
        return false;
    }
};

const getWindowClassName = (hwnd) => {
    try {
        const buf = Buffer.alloc(256 * 2);
        const len = GetClassNameW(hwnd, buf, 256);
        if (len <= 0) return '';
        return buf.toString('utf16le', 0, len * 2);
    } catch {
        return '';
    }
};

const toBigInt = (v) => {
    if (v === null || v === undefined) return 0n;
    if (typeof v === 'bigint') return v;
    return BigInt(v);
};

// 从 Z-order 顶部开始遍历所有顶层窗口，收集和目标显示器有交集的窗口矩形。
const collectOtherWindowRects = (ownHwnd, monitorRect, debug = false) => {
    const rects = [];

    let hwnd = GetTopWindow(0);
    let safety = 0;
    const MAX_ITER = 800;

    while (hwnd && safety < MAX_ITER) {
        safety++;

        try {
            const hwndBig = toBigInt(hwnd);
            if (hwndBig === 0n) break;

            const isOwn = ownHwnd !== null && hwndBig === ownHwnd;

            if (!isOwn) {
                const visible = IsWindowVisible(hwnd);
                const minimized = visible ? IsIconic(hwnd) : false;

                if (visible && !minimized) {
                    const className = getWindowClassName(hwnd);
                    if (!EXCLUDED_CLASS_NAMES.has(className)) {
                        const r = {};
                        if (GetWindowRect(hwnd, r)) {
                            const intersectsMonitor =
                                r.right > monitorRect.left &&
                                r.left < monitorRect.right &&
                                r.bottom > monitorRect.top &&
                                r.top < monitorRect.bottom;

                            if (intersectsMonitor && r.right - r.left >= 32 && r.bottom - r.top >= 32) {
                                rects.push({
                                    left: r.left,
                                    top: r.top,
                                    right: r.right,
                                    bottom: r.bottom,
                                    className,
                                });
                            }
                        }
                    } else if (debug && (className === 'TaskListThumbnailWnd' || className === 'TaskSwitcherWnd')) {
                        // Aero Peek / Alt+Tab 弹出时打一行，方便确认排除生效
                        console.log(`[FullscreenDetector] 已排除: ${className}`);
                    }
                }
            }
        } catch {
            // 忽略单个窗口的错误
        }

        hwnd = GetWindow(hwnd, GW_HWNDNEXT);
    }

    return rects;
};

const computeCoverage = (ownHwnd, debug = false) => {
    const fgHwndBig = GetForegroundWindow();
    const fgHwnd = toBigInt(fgHwndBig);

    const refHwnd = (ownHwnd !== null && fgHwnd === ownHwnd) ? ownHwnd : fgHwnd;

    const hMonitor = MonitorFromWindow(refHwnd, MONITOR_DEFAULTTONEAREST);
    if (!hMonitor) {
        if (debug) console.log('[FullscreenDetector] MonitorFromWindow 返回 0');
        return 0;
    }

    const mi = { cbSize: 40 };
    if (!GetMonitorInfoW(hMonitor, mi)) {
        if (debug) console.log('[FullscreenDetector] GetMonitorInfoW 失败');
        return 0;
    }

    const area = mi.rcMonitor;
    const width = area.right - area.left;
    const height = area.bottom - area.top;
    if (width <= 0 || height <= 0) return 0;

    const rects = collectOtherWindowRects(ownHwnd, area, debug);

    if (debug) {
        console.log(`[FullscreenDetector] 收集到 ${rects.length} 个窗口矩形`);
        if (rects.length > 0 && rects.length <= 6) {
            rects.forEach(r => console.log(`  - ${r.className} [${r.left},${r.top}]-[${r.right},${r.bottom}]`));
        }
    }

    if (rects.length === 0) return 0;

    let covered = 0;
    const total = SAMPLE_GRID * SAMPLE_GRID;

    for (let row = 0; row < SAMPLE_GRID; row++) {
        for (let col = 0; col < SAMPLE_GRID; col++) {
            const x = Math.floor(area.left + ((col + 0.5) * width) / SAMPLE_GRID);
            const y = Math.floor(area.top + ((row + 0.5) * height) / SAMPLE_GRID);

            for (let i = 0; i < rects.length; i++) {
                const r = rects[i];
                if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) {
                    covered++;
                    break;
                }
            }
        }
    }

    return covered / total;
};

const createFullscreenDetector = ({
    getMainWindowHwnd,
    onFullscreenChanged,
    intervalMs = 800,
    debug = false,
}) => {
    if (process.platform !== 'win32' || !ensureLoaded()) {
        return {
            start: () => {},
            stop: () => {},
            isAvailable: () => false,
        };
    }

    let timer = null;
    let lastState = false;
    let lastLoggedCoverage = -1;

    const check = () => {
        try {
            const ownNum = typeof getMainWindowHwnd === 'function' ? getMainWindowHwnd() : null;
            const ownHwnd = ownNum !== null && ownNum !== undefined ? toBigInt(ownNum) : null;

            const coverage = computeCoverage(ownHwnd, debug);
            const isFs = coverage >= COVERAGE_THRESHOLD;

            // 覆盖率变化超过 2% 才打印，避免刷屏
            if (debug && Math.abs(coverage - lastLoggedCoverage) > 0.02) {
                lastLoggedCoverage = coverage;
                console.log(`[FullscreenDetector] coverage=${(coverage * 100).toFixed(1)}% isFs=${isFs}`);
            }

            if (isFs !== lastState) {
                lastState = isFs;
                try {
                    onFullscreenChanged(isFs);
                } catch {
                    // 忽略回调错误
                }
            }
        } catch (error) {
            if (debug) {
                console.warn('[FullscreenDetector] check 出错:', error && error.message);
            }
        }
    };

    return {
        start: () => {
            if (timer) return;
            check();
            timer = setInterval(check, intervalMs);
            if (typeof timer.unref === 'function') timer.unref();
        },
        stop: () => {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
            if (lastState) {
                lastState = false;
                try { onFullscreenChanged(false); } catch {}
            }
        },
        isAvailable: () => true,
    };
};

module.exports = { createFullscreenDetector };

import React, { useEffect, useRef, useState } from 'react';
import type { DongbiBackgroundTuning } from '../../../../types';
import { loadDongbiVideo } from '../../../../services/dongbiVideoStore';
import { useVisualizerSettingsStore } from '../../../../stores/useVisualizerSettingsStore';

// src/components/visualizer/backgrounds/dongbi/DongbiBackground.tsx
// Renders a user-supplied local video as the shell background, cover-fit,
// looped, with adjustable volume and playback rate.
//
// 性能说明（壁纸模式）：
// - 该层用 translateZ(0) 提升为 GPU 合成层。
// - 当 pauseWhenHidden 打开时，切标签页/最小化、以及桌面版检测到其他应用
//   全屏时暂停。打开小窗口覆盖 Folia 时不暂停。
// - 组件卸载（切到其他背景）时，视频暂停。
//
// 生命周期：Blob URL 由这里统一管理，切换/清除/卸载时自动 revoke。
// 恢复：启动时若 store 里没有 videoUrl，从 IndexedDB 读文件重建 URL，
// 并直接写回 store（不依赖父组件的 onTuningChange，因为主界面渲染背景时
// 不会经过设置面板，那个回调是 undefined）。

interface DongbiBackgroundProps {
    tuning?: DongbiBackgroundTuning;
    paused?: boolean;
    onTuningChange?: (patch: Partial<DongbiBackgroundTuning>) => void;
}

const DongbiBackground: React.FC<DongbiBackgroundProps> = ({ tuning, paused }) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const videoUrl = tuning?.videoUrl;
    const volume = tuning?.volume ?? 0;
    const playbackRate = tuning?.playbackRate ?? 1;
    const pauseWhenHidden = tuning?.pauseWhenHidden ?? true;

    // 桌面版：主进程检测到"其他应用全屏"时置 true
    const [externalFullscreen, setExternalFullscreen] = useState(false);

    // 生命周期管理：追踪当前活跃的 Blob URL，切换时延后 revoke 旧的
    const prevUrlRef = useRef<string | undefined>(undefined);
    useEffect(() => {
        const prevUrl = prevUrlRef.current;
        if (prevUrl === videoUrl) return;
        prevUrlRef.current = videoUrl;

        if (prevUrl?.startsWith('blob:')) {
            const timer = window.setTimeout(() => {
                try { URL.revokeObjectURL(prevUrl); } catch { /* 已释放 */ }
            }, 3000);
            return () => window.clearTimeout(timer);
        }
    }, [videoUrl]);

    

    // 启动时若 store 里没有 videoUrl，从 IndexedDB 恢复
    // 直接调 store：主界面渲染背景时不经过设置面板，没有 actions 可用
    useEffect(() => {
        if (videoUrl) return;
        let cancelled = false;
        loadDongbiVideo().then((data) => {
            if (cancelled || !data) return;
            const url = URL.createObjectURL(data.blob);
            useVisualizerSettingsStore.getState().handleSetDongbiBackgroundTuning({
                videoUrl: url,
                videoName: data.name,
            });
        }).catch(() => {
            // 读取失败静默处理，用户可手动重新选视频
        });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 订阅主进程的全屏检测信号（仅 Electron 桌面版有效）
    useEffect(() => {
        if (!pauseWhenHidden) {
            setExternalFullscreen(false);
            return;
        }
        const electron = (window as { electron?: { onExternalFullscreenChanged?: (cb: (v: boolean) => void) => () => void } }).electron;
        if (!electron?.onExternalFullscreenChanged) return;
        const unsubscribe = electron.onExternalFullscreenChanged((isFs: boolean) => {
            setExternalFullscreen(Boolean(isFs));
        });
        return unsubscribe;
    }, [pauseWhenHidden]);

    // 应用音量 / 播放速度 / 播放状态
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        video.volume = Math.max(0, Math.min(1, volume));
        video.muted = volume <= 0;
        video.playbackRate = Math.max(0.25, Math.min(4, playbackRate));

        const shouldPause = paused || externalFullscreen;
        if (shouldPause) {
            video.pause();
        } else {
            video.play().catch(() => {
                // 浏览器自动播放策略拦截，静默忽略
            });
        }
    }, [videoUrl, volume, playbackRate, paused, externalFullscreen]);

    // 标签页隐藏时暂停
    useEffect(() => {
        if (!pauseWhenHidden) return;

        const handleVisibilityChange = () => {
            const video = videoRef.current;
            if (!video) return;
            if (document.hidden) {
                video.pause();
            } else if (!paused && !externalFullscreen) {
                video.play().catch(() => {});
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [pauseWhenHidden, paused, externalFullscreen]);

    // 组件卸载时暂停视频
    useEffect(() => {
        return () => {
            const video = videoRef.current;
            if (video) video.pause();
        };
    }, []);

    if (!videoUrl) {
        return (
            <div className="absolute inset-0 z-0 flex items-center justify-center bg-black text-sm text-white/60">
                未选择视频（请在设置 → 外观 → 背景中上传）
            </div>
        );
    }

    return (
        <video
            ref={videoRef}
            className="absolute inset-0 z-0 h-full w-full object-cover"
            style={{ transform: 'translateZ(0)' }}
            src={videoUrl}
            autoPlay
            loop
            muted={volume <= 0}
            playsInline
            preload="auto"
        />
    );
};

export default DongbiBackground;

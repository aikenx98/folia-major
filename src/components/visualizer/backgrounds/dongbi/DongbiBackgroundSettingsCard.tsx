import React, { useRef } from 'react';
import type { DongbiBackgroundTuning, Theme } from '../../../../types';
import { saveDongbiVideo, clearDongbiVideo } from '../../../../services/dongbiVideoStore';

// src/components/visualizer/backgrounds/dongbi/DongbiBackgroundSettingsCard.tsx
// 动壁的设置面板：选择视频、音量、播放速度、省电暂停。
//
// 选择视频时：
// - 立即用 URL.createObjectURL(file) 生成 URL 让画面出得快
// - 后台把文件写入 IndexedDB（saveDongbiVideo），写失败不影响本次播放
// 清除视频时：
// - 从 store 里移除 videoUrl / videoName
// - 从 IndexedDB 里删除（clearDongbiVideo）
// 旧的 Blob URL 由 DongbiBackground 里的生命周期管理统一 revoke。

interface DongbiBackgroundSettingsCardProps {
    t: (key: string) => string;
    isDaylight: boolean;
    theme: Theme;
    controlCardBg: string;
    tuning: DongbiBackgroundTuning;
    onTuningChange?: (patch: Partial<DongbiBackgroundTuning>) => void;
}

const DongbiBackgroundSettingsCard: React.FC<DongbiBackgroundSettingsCardProps> = ({
    controlCardBg,
    tuning,
    onTuningChange,
}) => {
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        // 先把 URL 交给 store，让视频立刻播放，不等待 IndexedDB 写入
        onTuningChange?.({ videoUrl: url, videoName: file.name });
        // 后台持久化文件，失败也不影响本次播放
        void saveDongbiVideo(file).catch((err) => {
            console.warn('[Dongbi] 视频持久化失败', err);
        });
        e.target.value = '';
    };

    const handleClear = () => {
        // 移除 store 里的引用；Blob URL 的实际 revoke 由 DongbiBackground 统一处理
        onTuningChange?.({ videoUrl: undefined, videoName: undefined });
        // 清掉 IndexedDB，重启后不会再恢复
        void clearDongbiVideo();
    };

    const pauseWhenHidden = tuning.pauseWhenHidden ?? true;

    return (
        <div
            className="space-y-4 rounded-2xl p-4"
            style={{ background: controlCardBg }}
        >
            <div>
                <div className="mb-2 text-xs opacity-70">视频文件</div>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/*"
                    onChange={handleFileChange}
                    className="hidden"
                />
                <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-lg px-3 py-2 text-sm"
                    style={{ border: '1px solid currentColor' }}
                >
                    {tuning.videoName ? `已选择：${tuning.videoName}` : '选择视频'}
                </button>
                {tuning.videoUrl && (
                    <button
                        type="button"
                        onClick={handleClear}
                        className="ml-2 rounded-lg px-3 py-2 text-sm opacity-70"
                    >
                        清除
                    </button>
                )}
            </div>

            <label className="block">
                <div className="mb-1 flex items-center justify-between text-xs opacity-70">
                    <span>音量</span>
                    <span>{Math.round((tuning.volume ?? 0) * 100)}%</span>
                </div>
                <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={tuning.volume ?? 0}
                    onChange={(e) => onTuningChange?.({ volume: parseFloat(e.target.value) })}
                    className="w-full"
                />
            </label>

            <label className="block">
                <div className="mb-1 flex items-center justify-between text-xs opacity-70">
                    <span>播放速度</span>
                    <span>{(tuning.playbackRate ?? 1).toFixed(2)}x</span>
                </div>
                <input
                    type="range"
                    min={0.25}
                    max={4}
                    step={0.25}
                    value={tuning.playbackRate ?? 1}
                    onChange={(e) => onTuningChange?.({ playbackRate: parseFloat(e.target.value) })}
                    className="w-full"
                />
            </label>

            {/* 性能开关：省电暂停 */}
            <div className="flex items-center justify-between gap-3 pt-1">
                <div className="min-w-0">
                    <div className="text-xs font-medium">省电暂停</div>
                    <div className="text-[10px] opacity-50 leading-snug">
                        其他应用全屏 / 最大化或切标签页时暂停播放，节省电量
                    </div>
                </div>
                <button
                    type="button"
                    role="switch"
                    aria-checked={pauseWhenHidden}
                    onClick={() => onTuningChange?.({ pauseWhenHidden: !pauseWhenHidden })}
                    className="relative h-6 w-11 shrink-0 rounded-full transition-all"
                    style={{
                        backgroundColor: pauseWhenHidden ? 'currentColor' : 'rgba(127,127,127,0.35)',
                    }}
                >
                    <div
                        className={`absolute top-1 left-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                            pauseWhenHidden ? 'translate-x-5' : 'translate-x-0'
                        }`}
                    />
                </button>
            </div>
        </div>
    );
};

export default DongbiBackgroundSettingsCard;

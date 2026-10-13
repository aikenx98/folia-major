import React, { useEffect, useRef, useState } from 'react';
import type { DongbiBackgroundTuning } from '../../../../types';

// src/components/visualizer/backgrounds/dongbi/DongbiBackground.tsx
// Renders a user-supplied local video as the shell background, cover-fit,
// looped, with adjustable volume and playback rate.
//
// Performance notes (wallpaper usage):
// - The layer is promoted to a GPU compositing layer via translateZ(0).
// - When `pauseWhenHidden` is on, the video pauses on tab hide and, in the
//   desktop app, when another application goes fullscreen (detected by the
//   main process). Opening a small window over Folia does NOT pause it.
// - On unmount (e.g. switching to another background), the video is paused.

interface DongbiBackgroundProps {
    tuning?: DongbiBackgroundTuning;
    paused?: boolean;
}

const DongbiBackground: React.FC<DongbiBackgroundProps> = ({ tuning, paused }) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const videoUrl = tuning?.videoUrl;
    const volume = tuning?.volume ?? 0;
    const playbackRate = tuning?.playbackRate ?? 1;
    const pauseWhenHidden = tuning?.pauseWhenHidden ?? true;

    // 桌面版：主进程检测到"其他应用全屏"时置 true
    const [externalFullscreen, setExternalFullscreen] = useState(false);

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

    // 标签页隐藏时暂停（切标签页、最小化窗口）。
    // 注意：不监听 blur/focus —— 打开小窗口会让 Folia 失焦，但那不应暂停。
    // 其他应用全屏的情况由主进程的 externalFullscreen 信号处理。
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

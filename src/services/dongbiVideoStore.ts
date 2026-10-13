// src/services/dongbiVideoStore.ts
// 用 IndexedDB 持久化动壁视频文件。
//
// 为什么不存 localStorage：Blob URL 只在当前会话有效，重启就失效。
// 为什么不存文件路径：Web 端拿不到 input[type=file] 的真实路径。
// IndexedDB 能把整个 Blob 存下来，重启后读回来 → 重建 Blob URL。
//
// 存储策略：固定 key 'current' + put（覆盖）→ 永远只存 1 个视频，不堆积磁盘。

const DB_NAME = 'folia-dongbi';
const DB_VERSION = 1;
const STORE_NAME = 'videos';
const VIDEO_KEY = 'current';

export interface StoredDongbiVideo {
    blob: Blob;
    name: string;
    updatedAt: number;
}

const openDb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
        }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
});

export const saveDongbiVideo = async (file: File): Promise<void> => {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({
            blob: file,
            name: file.name,
            updatedAt: Date.now(),
        } satisfies StoredDongbiVideo, VIDEO_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
};

export const loadDongbiVideo = async (): Promise<StoredDongbiVideo | null> => {
    try {
        const db = await openDb();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(VIDEO_KEY);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => resolve(null);
        });
    } catch {
        return null;
    }
};

export const clearDongbiVideo = async (): Promise<void> => {
    try {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(VIDEO_KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        // 清理失败不影响功能
    }
};

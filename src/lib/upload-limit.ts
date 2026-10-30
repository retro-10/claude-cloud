// The largest file a person may upload. 8 MB on an always-on server; Vercel refuses request bodies above about
// 4.5 MB, so there NEXT_PUBLIC_MAX_UPLOAD_MB=4 (public: forms show the limit too).
export const MAX_UPLOAD_MB = Math.min(8, Math.max(1, Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB) || 8));
export const MAX_FILE_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

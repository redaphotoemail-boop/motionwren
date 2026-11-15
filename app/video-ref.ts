/* One short reference for every video, so a film can be named in a message and found again.
   Built from the film's own id, so the same film always shows the same reference everywhere. */
export const videoRef = (id: string | null | undefined) => id ? `MW-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}` : "";

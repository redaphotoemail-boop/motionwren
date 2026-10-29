/* Groups a client's projects into orders and lists every deliverable.
   The create-video flow makes one project per video piece and records the
   order on each one ("Order K7Q2M · Hero listing film · Includes: … ·
   Goal: listed · Channels: …"). Graphic pieces are made by the team, so they
   appear only in that "Includes" list. Projects from before order codes
   existed are grouped when they were created together (same answers, within
   ten minutes); anything else stands on its own. Pure functions only. */

export type Project = {
  id: string;
  title: string;
  status: string;
  listingAddress?: string | null;
  shortMessage?: string | null;
  assetCount: number;
  aspect: string;
  resolution: string;
  targetDuration?: number | null;
  createdAt: number;
  updatedAt: number;
  finalHistoryId?: string | null;
  coverAssetId?: string | null;
  videoExpiresAt?: number | null;
};

export type DeliverableKind = "film" | "reel" | "story" | "post" | "graphic" | "cover";
export type StatusGroup = "production" | "completed" | "draft" | "failed";

export type Deliverable =
  | { type: "video"; key: string; kind: DeliverableKind; title: string; project: Project; group: StatusGroup }
  | { type: "design"; key: string; kind: DeliverableKind; title: string };

export type Order = {
  key: string;
  code: string | null;
  title: string;
  goal: string | null;
  createdAt: number;
  updatedAt: number;
  cover: { projectId: string; assetId: string } | null;
  listingAddress: string | null;
  projects: Project[];
  deliverables: Deliverable[];
  videos: number;
  ready: number;
  group: StatusGroup;
};

/* Everything that is neither saved, finished nor stopped is being made. */
export const groupOf = (status: string): StatusGroup =>
  status === "draft" ? "draft" : status === "failed" || status === "cancelled" ? "failed" : status === "completed" ? "completed" : "production";

const GOALS: Record<string, string> = {
  listed: "Just listed",
  sold: "Just sold",
  open: "Open house",
  price: "Price change",
  luxury: "Luxury showcase",
  rent: "For rent",
  other: "Listing",
};

const VIDEO_TITLES: Record<string, DeliverableKind> = { "hero listing film": "film", "vertical reel": "reel", "story teaser": "story" };

export function kindOf(title: string, aspect?: string): DeliverableKind {
  const name = title.trim().toLowerCase();
  if (VIDEO_TITLES[name]) return VIDEO_TITLES[name];
  if (name.includes("post")) return "post";
  if (name.includes("cover")) return "cover";
  if (name.includes("graphic") || name.includes("invite") || name.includes("flyer") || name.includes("card")) return "graphic";
  return aspect === "vertical" ? "reel" : "film";
}

export type Parsed = { code: string | null; goal: string | null; includes: string[]; rest: string };

export function parseSummary(message: string | null | undefined): Parsed {
  const parts = String(message || "").split(" · ").map((part) => part.trim()).filter(Boolean);
  let code: string | null = null;
  let goal: string | null = null;
  const includes: string[] = [];
  const rest: string[] = [];
  for (const part of parts) {
    const order = /^Order ([A-Z0-9]{4,8})$/.exec(part);
    if (order) { code = order[1]; continue; }
    if (part.startsWith("Goal: ")) { goal = part.slice(6).trim(); rest.push(part); continue; }
    if (part.startsWith("Includes: ")) {
      part.slice(10).split(", ").map((item) => item.trim()).filter(Boolean).forEach((item) => includes.push(item));
      rest.push(part);
      continue;
    }
    if (part.startsWith("Channels: ")) rest.push(part);
  }
  return { code, goal, includes, rest: rest.join(" · ") };
}

const TEN_MINUTES = 10 * 60 * 1000;

export function buildOrders(projects: Project[]): Order[] {
  const sorted = [...projects].sort((a, b) => a.createdAt - b.createdAt);
  const buckets = new Map<string, Project[]>();
  let legacy: { key: string; rest: string; last: number } | null = null;
  for (const project of sorted) {
    const parsed = parseSummary(project.shortMessage);
    let key: string;
    if (parsed.code) {
      key = `order:${parsed.code}`;
      legacy = null;
    } else if (parsed.rest && (VIDEO_TITLES[project.title.trim().toLowerCase()] || project.title.trim().toLowerCase() === "content package")) {
      // Older package pieces: same answers, made within minutes of each other.
      if (legacy && legacy.rest === parsed.rest && project.createdAt - legacy.last <= TEN_MINUTES) key = legacy.key;
      else key = `legacy:${project.id}`;
      legacy = { key, rest: parsed.rest, last: project.createdAt };
    } else {
      key = `project:${project.id}`;
      legacy = null;
    }
    const list = buckets.get(key) || [];
    list.push(project);
    buckets.set(key, list);
  }

  const orders: Order[] = [];
  for (const [key, list] of buckets) {
    const parsedList = list.map((project) => parseSummary(project.shortMessage));
    const code = parsedList.find((parsed) => parsed.code)?.code || null;
    const goal = parsedList.find((parsed) => parsed.goal)?.goal || null;
    const deliverables: Deliverable[] = [];
    const seen = new Set<string>();
    const videoProjects = list.filter((project) => project.title.trim().toLowerCase() !== "content package");
    for (const project of videoProjects) {
      const title = project.title.trim();
      seen.add(title.toLowerCase());
      deliverables.push({ type: "video", key: project.id, kind: kindOf(title, project.aspect), title, project, group: groupOf(project.status) });
    }
    for (const parsed of parsedList) {
      for (const item of parsed.includes) {
        const name = item.toLowerCase();
        if (seen.has(name)) continue;
        seen.add(name);
        deliverables.push({ type: "design", key: `${key}:${name}`, kind: kindOf(item), title: item });
      }
    }
    // A saved order with no production project still shows what was ordered.
    if (!deliverables.length) {
      for (const project of list) deliverables.push({ type: "video", key: project.id, kind: kindOf(project.title, project.aspect), title: project.title, project, group: groupOf(project.status) });
    }
    const coverProject = [...list].sort((a, b) => a.createdAt - b.createdAt).find((project) => project.coverAssetId);
    const videos = deliverables.filter((item) => item.type === "video") as Extract<Deliverable, { type: "video" }>[];
    const groups = videos.map((item) => item.group);
    // An order of designed pieces only is in the team's hands, not just saved.
    const group: StatusGroup = !videos.length ? "production" : groups.includes("failed") ? "failed" : groups.includes("production") ? "production" : groups.includes("completed") ? "completed" : "draft";
    const firstTitle = list[0]?.title || "Order";
    const isPackage = key.startsWith("order:") || key.startsWith("legacy:") || list.length > 1;
    orders.push({
      key,
      code,
      title: goal && GOALS[goal] ? GOALS[goal] : isPackage ? "Content package" : firstTitle,
      goal,
      createdAt: Math.min(...list.map((project) => project.createdAt)),
      updatedAt: Math.max(...list.map((project) => project.updatedAt)),
      cover: coverProject?.coverAssetId ? { projectId: coverProject.id, assetId: coverProject.coverAssetId } : null,
      listingAddress: list.find((project) => project.listingAddress)?.listingAddress || null,
      projects: list,
      deliverables: deliverables.sort((a, b) => order(a) - order(b)),
      videos: videos.length,
      ready: groups.filter((value) => value === "completed").length,
      group,
    });
  }
  return orders.sort((a, b) => b.createdAt - a.createdAt);
}

const RANK: Record<DeliverableKind, number> = { film: 0, reel: 1, story: 2, post: 3, graphic: 4, cover: 5 };
function order(item: Deliverable) {
  return (item.type === "video" ? 0 : 10) + RANK[item.kind];
}

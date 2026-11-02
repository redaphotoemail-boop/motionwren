import type { MetadataRoute } from "next";

/* Public pages are indexable; signed-in areas and the API are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/studio", "/dashboard", "/api/", "/signin/reset"] }],
    sitemap: "https://motionwren.com/sitemap.xml",
    host: "https://motionwren.com",
  };
}

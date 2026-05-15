import type { CollectionEntry } from "astro:content";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type BlogEntry = CollectionEntry<"blog">;

const rootDir = process.cwd();

export function getPostDate(entry: BlogEntry) {
	if (entry.data.date) return entry.data.date;

	const filePath = entry.filePath;
	if (!filePath) return new Date(0);

	try {
		const out = execFileSync(
			"git",
			["log", "--follow", "--diff-filter=A", "--format=%cI", "--", filePath],
			{ cwd: rootDir, encoding: "utf8" },
		)
			.trim()
			.split("\n")
			.at(-1);
		if (out) return new Date(out);
	} catch {}

	try {
		return fs.statSync(path.join(rootDir, filePath)).mtime;
	} catch {}

	return new Date(0);
}

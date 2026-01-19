
const MAIN_URL = "https://yts.bz";
const TRACKER_API = "https://newtrackon.com/api/stable";

function getManifest() {
    return {
        id: "dev.akash.stars.yts",
        name: "YTS",
        internalName: "YTS",
        version: 1,
        description: "YTS Provider",
        language: "en",
        tvTypes: ["Movie"],
        baseUrl: MAIN_URL,
        iconUrl: ""
    };
}

async function getHome() {
    const sections = [
        { title: "Latest Movies", url: "/browse-movies?order_by=latest" },
        { title: "Popular Movies", url: "/browse-movies?order_by=downloads" },
        { title: "Top Rated Movies", url: "/browse-movies?order_by=rating" },
        { title: "4K Movies", url: "/browse-movies?quality=2160p&order_by=latest" }
    ];

    const home = {};

    for (const section of sections) {
        try {
            const html = await _fetch(MAIN_URL + section.url);

            const items = _parseMovies(html);

            if (items.length > 0) {
                home[section.title] = items;
            }
        } catch (e) {
            // Error fetching home section
        }
    }
    return home;
}

async function search(query) {
    try {
        const url = MAIN_URL + "/browse-movies/" + encodeURIComponent(query) + "/all/all/0/latest/0/all";
        const html = await _fetch(url);
        return _parseMovies(html);
    } catch (e) {
        return [];
    }
}

async function load(url, cb) {
    try {
        const html = await _fetch(url);

        // Title
        const titleMatch = html.match(/<div[^>]*id="movie-info"[^>]*>[\s\S]*?<h1[^>]*>([^<]+)<\/h1>/);
        let title = titleMatch ? titleMatch[1].trim() : "Unknown Title";

        // Poster
        const posterMatch = html.match(/id=["']movie-poster["'][\s\S]*?src=["']([^"']+)["']/);
        let poster = posterMatch ? posterMatch[1] : "";
        if (poster && poster.startsWith("/")) {
            poster = MAIN_URL + poster;
        }

        // Year
        const yearMatch = html.match(/<div[^>]*id="movie-info"[^>]*>[\s\S]*?<h2[^>]*>([0-9]{4})<\/h2>/);
        const year = yearMatch ? parseInt(yearMatch[1]) : 0;

        // Description
        let description = "";
        const descMatch1 = html.match(/Plot summary<\/[hH][234]>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/);
        if (descMatch1) {
            description = descMatch1[1];
        } else {
            const descMatch2 = html.match(/<p[^>]*class=["']hidden-xs["'][^>]*>([\s\S]*?)<\/p>/);
            if (descMatch2) {
                description = descMatch2[1];
            } else {
                const descMatch3 = html.match(/<div[^>]*id=["']synopsis["'][^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/);
                if (descMatch3) description = descMatch3[1];
            }
        }

        if (description) {
            description = description.replace(/<[^>]+>/g, "").trim();
        }

        const ratingMatch = html.match(/itemprop=["']ratingValue["'][^>]*>([0-9.]+)/);
        const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0.0;


        const result = {
            url: url,
            title: title,
            posterUrl: poster,
            year: year,
            plot: description,
            description: description,
            rating: rating,
            type: "movie",
            isFolder: false,
            episodes: [
                {
                    name: "Full Movie",
                    url: url, // Pass page URL for loadStreams to fetch
                    season: 1,
                    episode: 1,
                    posterUrl: poster,
                    description: description
                }
            ]
        };

        // If cb is provided, use it; otherwise return (for consistency if generic engine handles both)
        // But the fix implies we MUST use cb if the engine expects it
        if (cb) cb(result);
        else return result;

    } catch (e) {
        if (cb) cb({ title: "Error" });
        else return { title: "Error" };
    }
}

async function loadStreams(url, cb) {
    try {
        const html = await _fetch(url);
        const links = [];

        // Direct Magnet Links from page
        const magnetRegex = /href="(magnet:\?xt=urn:btih:[^"]+)"/g;
        let magnetMatch;
        const seenMagnets = new Set();
        let magnetCount = 0;

        while ((magnetMatch = magnetRegex.exec(html)) !== null) {
            const magnet = magnetMatch[1];
            if (seenMagnets.has(magnet)) continue;
            seenMagnets.add(magnet);
            magnetCount++;
        }

        // Fetch Trackers
        let trackers = "";
        try {
            trackers = await _fetch(TRACKER_API);
        } catch (e) {
        }
        const trackerList = trackers.split("\n").filter(t => t.trim().length > 0);

        // Parse download buttons/links
        const anchorRegex = /<a[^>]+href="[^"]+\/download\/([a-zA-Z0-9]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
        let match;
        const seenHashes = new Set();
        let buttonCount = 0;

        while ((match = anchorRegex.exec(html)) !== null) {
            buttonCount++;
            const fullTag = match[0];
            const hash = match[1];

            if (seenHashes.has(hash)) continue;
            seenHashes.add(hash);

            const titleMatch = fullTag.match(/title="([^"]*)"/);
            const titleText = titleMatch ? titleMatch[1] : "";
            const innerText = match[2].replace(/<[^>]+>/g, "").trim();

            // Prefer innerText (e.g. "720p.BLURAY") over titleText (e.g. "Download ... 720p Torrent")
            // because innerText often contains the source qualifier.
            let qualityText = innerText || titleText;

            // Cleanup: Remove generic words
            // Simple robust removal
            qualityText = qualityText.replace(/Download/gi, "")
                .replace(/Torrent/gi, "")
                .replace(/Magnet/gi, "")
                .replace(/Movie/gi, "")
                .replace(/YIFY/gi, "")
                .replace(/\s+/g, " ")
                .trim();

            let quality = qualityText;
            if (innerText.includes("2160p") || titleText.includes("2160p")) quality = "4K";
            else if (innerText.includes("1080p") || titleText.includes("1080p")) quality = "1080p";
            else if (innerText.includes("720p") || titleText.includes("720p")) quality = "720p";
            else if (innerText.includes("3D") || titleText.includes("3D")) quality = "3D";

            // If the text became empty (e.g. it was just "Download"), use the detected quality
            if (qualityText.length === 0 || qualityText.length < 2) {
                qualityText = quality !== "Auto" ? quality : "Source";
            } else {
                if (!qualityText.includes(quality) && quality !== "Auto") {
                    qualityText = quality + " " + qualityText;
                }
            }

            let magnet = "magnet:?xt=urn:btih:" + hash;
            magnet += "&dn=" + hash;

            for (const t of trackerList) {
                magnet += "&tr=" + encodeURIComponent(t.trim());
            }

            links.push({
                url: magnet,
                quality: qualityText,
                headers: {}
            });
        }


        if (links.length === 0) {
            magnetRegex.lastIndex = 0;
            while ((magnetMatch = magnetRegex.exec(html)) !== null) {
                // Check if we already found this magnet via buttons?
                // The hash regex extracts the hash part from `magnet:?xt=urn:btih:HASH`
                // But simpler to just check if we added this URL or Hash.
                // Let's assume standalone magnets are unique playables if buttons failed.
                links.push({
                    url: magnetMatch[1],
                    quality: "Magnet",
                    headers: {}
                });
            }
        }


        // Priority Sorting: 1080p first as per user request
        links.sort((a, b) => {
            const aIs1080 = a.quality.includes("1080p");
            const bIs1080 = b.quality.includes("1080p");

            if (aIs1080 && !bIs1080) return -1;
            if (!aIs1080 && bIs1080) return 1;
            return 0;
        });

        if (cb) cb(links);
        else return links;

    } catch (e) {
        if (cb) cb([]);
        else return [];
    }
}

// Aliases for compatibility
const loadLinks = loadStreams;
const loadUrl = loadStreams;

function _parseMovies(html) {
    const results = [];
    // Helper to parse movie cards
    // NOTE: We split by the START of the div because class has other attributes (col-xs etc)
    const items = html.split('<div class="browse-movie-wrap');

    for (let i = 1; i < items.length; i++) {
        const item = items[i];

        try {
            const linkMatch = item.match(/href="([^"]+)"/);
            const posterMatch = item.match(/src="([^"]+)"/);
            const titleMatch = item.match(/class="browse-movie-title"[^>]*>([^<]+)</);

            if (linkMatch && titleMatch) {
                results.push({
                    url: linkMatch[1].startsWith("http") ? linkMatch[1] : MAIN_URL + linkMatch[1],
                    title: titleMatch[1].trim(),
                    posterUrl: posterMatch ? posterMatch[1] : "",
                    year: 0,
                    type: "movie"
                });
            }
        } catch (e) {
            // Error parsing item
        }
    }
    return results;
}

// Explicit Exports
globalThis.getManifest = getManifest;
globalThis.getHome = getHome;
globalThis.search = search;
globalThis.load = load;
globalThis.loadStreams = loadStreams;
globalThis.loadLinks = loadLinks;
globalThis.loadUrl = loadUrl;

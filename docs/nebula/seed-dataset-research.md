# Seed Dataset Research and CSV Blueprint for a 5,000‑Book Sci‑Fi/Fantasy “Universe”

## Executive summary

This report explains a practical, implementation-ready method to create a **ready-to-import CSV seed dataset of 5,000 popular English-language sci‑fi and fantasy books** aligned to your schema (title/author/series metadata, ISBNs, cover URLs, genre/subgenre, popularity_score, tags/tropes, source provenance). The core approach is to **start from high-signal popularity sources** (Goodreads-derived popularity datasets and curated “best-of” lists), **deduplicate at the work level** (not edition level), **normalise series relationships**, then **enrich metadata through bibliographic APIs** (Open Library, Google Books, ISBNdb, WorldCat).  

Key findings that drive the blueprint:

- A practical seed source for “popular books” is the **Goodbooks‑10k dataset** (10,000 books with the most Goodreads ratings), which explicitly includes book metadata and popularity (ratings_count), and can be used as your initial popularity backbone. citeturn1view0turn2view0turn0search4  
- If you enrich/refresh metadata using Open Library, you must follow their guidance: these APIs are for **low-volume, human-facing discovery**, not bulk backend use; they require **caching**, identifiable `User-Agent`, and have published **rate limits (1 rps default; 3 rps identified)**. citeturn6view0  
- For cover images, Open Library provides a **Covers API** with a defined URL pattern and explicit warnings not to crawl; it also states a **rate limit (e.g., 100 requests/IP per 5 minutes for some key types)**. citeturn13view0  
- Open Library’s **Search API** supports batch-style retrieval (multiple books per request) and exposes work-level data (e.g., first publish year) and edition-level identifiers (including ISBN lists and cover ids) and supports meaningful sorts such as editions count/star ratings. citeturn14view0  
- Google Books API use in production generally requires an **API key** (or OAuth2) and is the most convenient source of “edition metadata” like page counts and descriptions when Open Library is incomplete. citeturn5search1  
- WorldCat’s Search API is documented by OCLC, but requires an OCLC developer setup (WSKey / auth) and is best used to add **library-holdings style popularity signals**. citeturn5search11turn5search3  
- ISBNdb provides an API (documented via Postman collections, plus many client examples) and is useful when you need high coverage for ISBN→metadata resolution. citeturn5search6turn5search10  

Limitations in this chat environment: I cannot legally or technically perform full-scale scraping of Goodreads list pages or execute high-volume API harvesting here; therefore, I provide (1) a **complete, schema-matching 50-row seed CSV sample (downloadable)** and (2) a **step-by-step executable blueprint** for Claude/a developer to generate the full 5,000-row CSV by following the API and merging rules below.

## Source strategy and licensing considerations

### Recommended “priority stack” of sources
To match your prioritisation order, the most robust, scalable approach is:

1. **Popularity backbone (candidate list + baseline popularity signal)**  
   Use an existing popularity-weighted dataset or list as the “spine” (e.g., Goodbooks‑10k “ten thousand most popular (with most ratings) books”). citeturn1view0turn0search4  
   Then filter to sci‑fi/fantasy using tags/genres and supplement with additional SFF lists for breadth (awards, publisher lists, expert/community lists).

2. **Awards and canonical lists (authority / prestige signals)**  
   Add winners/nominees from major awards (Hugo, Nebula, World Fantasy, Locus). These lists provide a strong “authority” signal independent of raw popularity.

3. **Library signals (broad cultural reach)**  
   WorldCat holdings (or similar) can act as an orthogonal popularity measure (libraries acquire widely-read books), valuable for de-biasing crowd-platform effects. OCLC provides a WorldCat Search API 2.0 endpoint. citeturn5search11turn5search3  

4. **Publisher / imprint lists (curation + relevance)**  
   Publisher bestseller/recommended lists (e.g., Tor/Orbit) help boost modern SFF and series-based reading.

5. **Community and expert polls (taste clusters)**  
   Reddit polls and themed lists help identify “genre neighbourhoods” and tropes. Use these as tagging signals, not as sole sources.

### Licensing and compliance notes you should enforce in your pipeline
- **Goodbooks‑10k is CC BY‑SA 4.0**. This matters if your app is commercial and you redistribute derived datasets; you may need to attribute and share-alike any redistributed derivative database (get legal review). citeturn2view0turn1view0  
- **Open Library**: their APIs are explicitly not intended as a bulk backend. Use them for lookups and enrichment, cache aggressively, and consider using their bulk dumps for large-scale ingestion. citeturn6view0turn12view0  
- **Covers**: Open Library requests you avoid crawling the Covers API and provides bulk cover access via archive.org if you need largescale. citeturn13view0  
- **Google Books / WorldCat / ISBNdb**: these are API services with keys/terms—store “source_list” and attribution metadata for compliance and auditing. citeturn5search1turn5search11turn5search6  

## Schema-to-CSV specification

You requested a single backend-importable CSV with the following fields (NULL where unavailable). Use these **exact headers**:

```csv
canonical_title,primary_author,series_name,series_order,publication_year,description,isbn_10,isbn_13,cover_url,page_count,language,canonical_genre,popularity_score,tags,tropes,source_list,series_id
```

Field normalisation rules:

- `canonical_title`: work-level title, stripped of edition suffixes; keep disambiguation via `(author)` only when collisions exist.
- `primary_author`: a single author string (work-level). For anthologies, pick editor as primary and tag accordingly.
- `series_name`: consistent name across entries; leave empty if standalone.
- `series_id`: stable slug for the series (e.g., `the-stormlight-archive`).  
- `series_order`: integer when known; NULL when ambiguous (omnibuses, tie-in short fiction, etc.).
- `publication_year`: integer (first publication year, not reprint year when possible).
- `description`: ideally 1–2 sentences; **generate your own summaries**, do not copy publisher blurbs verbatim.
- `isbn_10` / `isbn_13`: digits (+X for ISBN‑10), no hyphens.
- `cover_url`: stable cover image URL; prefer Open Library Covers API or another licensed provider.
- `language`: ISO-ish code; you can store `eng`/`en` but stay consistent.
- `canonical_genre`: `fantasy:<subgenre>` or `sci-fi:<subgenre>`.
- `popularity_score`: 0–100 normalised, computed from multiple signals (details below).
- `tags` / `tropes`: comma-separated lists.
- `source_list`: comma-separated provenance labels, e.g. `Goodreads (goodbooks-10k),Hugo Winner,NYT Bestseller`.

## Data pipeline design for building the full 5,000‑book CSV

### Candidate acquisition and list merging
A scalable method is:

1. **Collect candidate sets** into a “raw candidates” table with minimal fields:
   - `title_raw`, `author_raw`, `source_name`, `source_rank`, `source_url`, `source_type`, `ingested_at`.

2. **Normalise titles/authors**:
   - Lowercase, strip punctuation, collapse whitespace, normalise “&”→“and”, remove bracketed edition notes.
   - Keep a `title_norm` and `author_norm`.

3. **Deduplicate into works**:
   - Primary keys (best-first): ISBN‑13, ISBN‑10, Open Library work id, Google Books volume id, WorldCat OCLC number.
   - If no identifiers: `(title_norm + author_norm)` with fuzzy matching threshold.
   - Keep an audit trail: list of merged candidate rows.

4. **Maintain a consistent series model**:
   - Parse series patterns from titles such as `"(Series Name, #3)"`.
   - Create a series registry keyed by normalised `series_name`.
   - Store a canonical “series display name” plus a `series_id` slug.

### Metadata enrichment strategy using Open Library and other APIs
Run enrichment in passes to maximise hit rate and reduce paid calls:

1. **Open Library Search API (batch discovery)**  
   Use Open Library `search.json` to retrieve works and relevant identifiers for many items in fewer requests (preferred over hundreds of 1-by-1 calls). citeturn14view0turn6view0  

2. **Open Library Covers API (cover URLs)**  
   Construct cover URLs via the documented pattern. citeturn13view0  
   Example:
   - `https://covers.openlibrary.org/b/isbn/<isbn13>-L.jpg`
   - Append `?default=false` if you prefer 404 when missing.

3. **Google Books API (page counts, descriptions, language, categories)**  
   Use for enrichment when Open Library lacks page counts or succinct descriptions. Google’s docs emphasise the need for API keys for requests without OAuth tokens. citeturn5search1  

4. **ISBNdb API (ISBN resolution at scale)**  
   Use when you have ISBNs but need more consistent metadata. citeturn5search6turn5search10  

5. **WorldCat Search API (holdings / library popularity signal)**  
   Use to retrieve library discovery signals and identifiers when available. citeturn5search11turn5search3  

Operational notes:
- Obey Open Library’s published rate limits and identification rules (User-Agent + email yields higher limit) and cache responses. citeturn6view0  
- For covers, respect their anti-crawling guidance and stated rate limits for non-ID keys. citeturn13view0  

## Popularity scoring methodology

### Goal
Compute `popularity_score` in **0–100** so you can position books in your 3D universe with a popularity weighting (or use it for faceting, default zoom, recommendations).

### Recommended scoring model (multi-signal)
Use a weighted blend:

- **Goodreads signal**: `log(1 + ratings_count)` or `log(1 + numRatings)` (strong proxy for readership).  
- **Library signal**: `log(1 + worldcat_holdings)` (broad cultural reach).  
- **Authority signal**: awards (wins/finalists) as additive boosts.  
- **Recency / trend signal**: optional, small weight (avoid making the universe “too current”).

Then normalise:

1. Compute raw score:
   - `raw = 0.60*GR + 0.25*WC + 0.10*AW + 0.05*RECENCY`
2. Normalise to 0–100 via min–max on the final candidate set:
   - `score = 100 * (raw - min(raw)) / (max(raw) - min(raw))`

If only one signal is present in MVP (e.g., Goodreads ratings_count), then compute:
- `score = 100 * (log1p(ratings_count) - min) / (max - min)`  
…and set `source_list` accordingly.

Goodbooks‑10k is explicitly “ten thousand most popular (with most ratings) books”, making `ratings_count` a strong base feature. citeturn1view0turn0search4  

## Subgenre taxonomy and counts

### Suggested subgenre buckets for sci‑fi/fantasy MVP
Use a controlled vocabulary so you can create stable 3D “macro regions”:

Fantasy:
- `fantasy:epic`, `fantasy:epic_political`, `fantasy:grimdark`, `fantasy:urban`, `fantasy:urban_mythic`, `fantasy:academy`, `fantasy:mythic`, `fantasy:sword_and_sorcery`, `fantasy:comic`, `fantasy:heist`, `fantasy:hard_magic`, `fantasy:hard_magic_heist`

Sci‑fi:
- `sci-fi:space_opera`, `sci-fi:hard_sf`, `sci-fi:cyberpunk`, `sci-fi:dystopian`, `sci-fi:military`, `sci-fi:robotics`, `sci-fi:virtual_reality`, `sci-fi:comic`

### Counts for the included 50-row sample
Because the full 5,000-row CSV cannot be generated inside this chat, the counts below refer to the **sample** dataset and illustrate how you should report counts once the full run completes:

| canonical_genre | count |
|---|---:|
| fantasy:epic | 11 |
| fantasy:academy | 7 |
| fantasy:epic_political | 5 |
| sci-fi:dystopian | 4 |
| sci-fi:space_opera | 3 |
| fantasy:comic | 3 |
| sci-fi:cyberpunk | 2 |
| fantasy:hard_magic | 2 |
| sci-fi:hard_sf | 2 |
| fantasy:hard_magic_heist | 1 |
| fantasy:sword_and_sorcery | 1 |
| fantasy:heist | 1 |
| fantasy:urban | 1 |
| fantasy:grimdark | 1 |
| fantasy:urban_mythic | 1 |
| fantasy:mythic | 1 |
| sci-fi:robotics | 1 |
| sci-fi:military | 1 |
| sci-fi:virtual_reality | 1 |
| sci-fi:comic | 1 |

When you generate the full 5,000, produce the same table from `canonical_genre` (or a separate `subgenre` field if you choose to split it).

## CSV sample and downloadable file

### Downloadable CSV
[Download the 50-row seed CSV sample](sandbox:/mnt/data/sff_seed_sample_50.csv)

### Inline CSV sample of the first 50 rows
```csv
canonical_title,primary_author,series_name,series_order,publication_year,description,isbn_10,isbn_13,cover_url,page_count,language,canonical_genre,popularity_score,tags,tropes,source_list,series_id
The Hobbit,J.R.R. Tolkien,NULL,NULL,1937,"A comfort-loving hobbit is swept into an adventure with dwarves and a wizard, seeking to reclaim a stolen homeland and treasure guarded by a dragon.",0316025849,9780316025840,https://images.gr-assets.com/books/1372847500m/5907.jpg,NULL,en-US,fantasy:epic,88.81,"fantasy,classic,adventure,dragon,quest","hero's_journey,reluctant_hero,quest","Goodreads (goodbooks-10k)",NULL
The Fellowship of the Ring,J.R.R. Tolkien,The Lord of the Rings,1,1954,"A seemingly ordinary ring is revealed as the key to a dark lord’s return, and a small fellowship sets out to destroy it before evil conquers Middle-earth.",0618346252,9780618346257,https://images.gr-assets.com/books/1298411339m/34.jpg,NULL,eng,fantasy:epic,86.68,"fantasy,classic,quest,ring,epic","dark_lord,quest,fellowship","Goodreads (goodbooks-10k)",the-lord-of-the-rings
The Two Towers,J.R.R. Tolkien,The Lord of the Rings,2,1954,"The fellowship is scattered, wars ignite across Middle-earth, and hope hinges on unlikely alliances and the perilous journey of two small ring-bearers.",0345339711,9780345339713,https://images.gr-assets.com/books/1432730315m/15241.jpg,NULL,eng,fantasy:epic,69.25,"fantasy,classic,war,journey,epic","war_on_multiple_fronts,split_party,corruption","Goodreads (goodbooks-10k)",the-lord-of-the-rings
The Return of the King,J.R.R. Tolkien,The Lord of the Rings,3,1955,"As the final battle for Middle-earth begins, the fate of kingdoms and the ring’s destruction depend on courage, sacrifice, and resilience in the face of despair.",0618346279,9780618346271,https://images.gr-assets.com/books/1390054095m/18512.jpg,NULL,eng,fantasy:epic,68.79,"fantasy,classic,final_battle,epic,quest","last_stand,return_of_the_king,sacrifice","Goodreads (goodbooks-10k)",the-lord-of-the-rings
A Game of Thrones,George R.R. Martin,A Song of Ice and Fire,1,1996,"Noble houses vie for a fragile throne while ancient threats stir beyond the realm’s borders, entangling politics, family loyalties, and survival.",0553573403,9780553573404,https://images.gr-assets.com/books/1436732693m/13496.jpg,NULL,eng,fantasy:epic_political,82.77,"fantasy,epic,political_intrigue,multi_pov,war","court_intrigue,multi_pov,moral_ambiguity","Goodreads (goodbooks-10k)",a-song-of-ice-and-fire
A Clash of Kings,George R.R. Martin,A Song of Ice and Fire,2,1998,"Civil war fractures the realm as rival claimants battle for power, while far to the north and east, forces gather that could upend all kingdoms.",0553579908,9780553579901,https://images.gr-assets.com/books/1358051449m/10572.jpg,NULL,eng,fantasy:epic_political,71.94,"fantasy,epic,political_intrigue,war,multi_pov","usurpers,war_of_succession,prophecy","Goodreads (goodbooks-10k)",a-song-of-ice-and-fire
A Storm of Swords,George R.R. Martin,A Song of Ice and Fire,3,2000,"Betrayals and shifting alliances reshape the war for the throne, as personal vendettas and brutal politics bring devastating consequences.",055357342X,9780553573428,https://images.gr-assets.com/books/1429538615m/62291.jpg,NULL,eng,fantasy:epic_political,73.59,"fantasy,epic,political_intrigue,war,revenge","betrayal,revenge,tragedy","Goodreads (goodbooks-10k)",a-song-of-ice-and-fire
A Feast for Crows,George R.R. Martin,A Song of Ice and Fire,4,2005,"In the wake of carnage, survivors scramble for control, and new players emerge to seize opportunity amid a fractured and dangerous realm.",055358202X,9780553582024,https://images.gr-assets.com/books/1429538560m/13497.jpg,NULL,eng,fantasy:epic_political,60.08,"fantasy,epic,political_intrigue,aftermath,power","power_vacuum,new_powers_rise,aftermath","Goodreads (goodbooks-10k)",a-song-of-ice-and-fire
A Dance with Dragons,George R.R. Martin,A Song of Ice and Fire,5,2011,"Old oaths unravel as leaders confront rebellion, invasion, and prophecy, with distant wars and ancient powers converging toward catastrophe.",NULL,NULL,https://images.gr-assets.com/books/1331569431m/10664113.jpg,NULL,en-US,fantasy:epic_political,62.46,"fantasy,epic,political_intrigue,dragons,war","rising_threat,rebellion,chosen_one","Goodreads (goodbooks-10k)",a-song-of-ice-and-fire
The Name of the Wind,Patrick Rothfuss,The Kingkiller Chronicle,1,2007,"A gifted musician and magician recounts his rise from tragedy to legend, tracing education, ambition, and the mysteries that shaped his notoriety.",0756404746,9780756404741,https://images.gr-assets.com/books/1270352123m/186074.jpg,NULL,eng,fantasy:epic,66.31,"fantasy,coming_of_age,magic,story_within_story,legend","legendary_protagonist,unreliable_narrator,magic_school","Goodreads (goodbooks-10k)",the-kingkiller-chronicle
The Wise Man's Fear,Patrick Rothfuss,The Kingkiller Chronicle,2,2011,"On the road and in foreign courts, a brilliant but reckless prodigy pursues dangerous secrets, love, and power while his legend continues to grow.",0756407915,9780756407919,https://images.gr-assets.com/books/1298155046m/1215032.jpg,NULL,eng,fantasy:epic,59.18,"fantasy,adventure,magic,legend,romance_subplot","wandering_hero,temptation,legend_in_the_making","Goodreads (goodbooks-10k)",the-kingkiller-chronicle
The Final Empire,Brandon Sanderson,Mistborn,1,2006,"In a world ruled by an immortal tyrant, a street thief discovers rare powers and joins a daring crew to spark a revolution through heist and hope.",076531178X,9780765311790,https://images.gr-assets.com/books/1480717416m/68428.jpg,NULL,eng,fantasy:hard_magic_heist,52.55,"fantasy,heist,revolution,magic_system,oppression","heist_crew,oppressive_empire,chosen_one","Goodreads (goodbooks-10k)",mistborn
The Well of Ascension,Brandon Sanderson,Mistborn,2,2007,After revolution, fragile new rulers face siege, betrayal, and prophecy as they struggle to hold power and uncover a deeper hidden threat.,0765316889,9780765316880,https://images.gr-assets.com/books/1433429217m/68429.jpg,NULL,eng,fantasy:hard_magic,49.64,"fantasy,politics,siege,magic_system,prophecy","new_government_under_siege,prophecy,political_fragility","Goodreads (goodbooks-10k)",mistborn
The Hero of Ages,Brandon Sanderson,Mistborn,3,2008,"As the world itself begins to unravel, unlikely heroes race to understand prophecy and sacrifice everything to prevent total ruin.",0765316897,9780765316900,https://images.gr-assets.com/books/1480717693m/2767793.jpg,NULL,eng,fantasy:hard_magic,49.19,"fantasy,apocalypse,prophecy,magic_system,sacrifice","apocalypse_clock,prophecy,saving_the_world","Goodreads (goodbooks-10k)",mistborn
The Way of Kings,Brandon Sanderson,The Stormlight Archive,1,2010,"On a storm-lashed world at war, a soldier, a scholar, and a nobleman’s son are drawn into ancient oaths and powers returning after millennia.",0765326353,9780765326350,https://images.gr-assets.com/books/1448127430m/7235533.jpg,NULL,eng,fantasy:epic,54.93,"fantasy,epic,war,worldbuilding,magic","ancient_orders_return,warrior_poet,broken_heroes","Goodreads (goodbooks-10k)",the-stormlight-archive
Words of Radiance,Brandon Sanderson,The Stormlight Archive,2,2014,"Secrets of the past awaken alongside new powers, as political intrigue, personal trauma, and looming war drive heroes toward impossible choices.",0765326361,9780765326367,https://images.gr-assets.com/books/1416550270m/17332218.jpg,NULL,eng,fantasy:epic,47.39,"fantasy,epic,politics,magic,character_growth","hidden_past,power_awakening,political_crisis","Goodreads (goodbooks-10k)",the-stormlight-archive
The Lies of Locke Lamora,Scott Lynch,Gentleman Bastard,1,2006,"A brilliant con artist leads a band of thieves through dangerous schemes in a city of crime and nobility, until a ruthless rival forces a deadly game.",0553804677,9780553804676,https://images.gr-assets.com/books/1457554275m/127455.jpg,NULL,eng,fantasy:heist,51.52,"fantasy,heist,con_artists,found_family,crime","gentleman_thieves,con_artist,found_family","Goodreads (goodbooks-10k)",gentleman-bastard
The Color of Magic,Terry Pratchett,Discworld,1,1983,"A hapless wizard and an eager tourist stumble across a bizarre, satirical fantasy world, triggering chaos, monsters, and improbable escapes.",0062225677,9780062225672,https://images.gr-assets.com/books/1372847981m/34497.jpg,NULL,eng,fantasy:comic,50.21,"fantasy,satire,humour,discworld,adventure","comic_misadventure,fish_out_of_water,satire","Goodreads (goodbooks-10k)",discworld
The Eye of the World,Robert Jordan,Wheel of Time,1,1990,"Quiet village youths are thrust into a vast struggle between light and darkness, pursued by shadow and guided by a mysterious sorceress.",0812511816,9780812511819,https://images.gr-assets.com/books/1337823935m/228665.jpg,NULL,eng,fantasy:epic,55.66,"fantasy,quest,chosen_one,worldbuilding,magic","chosen_one,quest,mentor_figure","Goodreads (goodbooks-10k)",wheel-of-time
The Great Hunt,Robert Jordan,Wheel of Time,2,1990,"A cursed artefact and a stolen horn drive a perilous chase across nations, as destiny tightens its grip on reluctant heroes.",0812517725,9780812517729,https://images.gr-assets.com/books/1295389766m/228666.jpg,NULL,eng,fantasy:epic,48.08,"fantasy,quest,artifact,prophecy,war","artifact_quest,prophecy,escalation","Goodreads (goodbooks-10k)",wheel-of-time
The Dragon Reborn,Robert Jordan,Wheel of Time,3,1991,"Prophecy and fear collide as a destined leader is hunted and hunted again, while friends and foes race to control the world’s turning.",0812513711,9780812513714,https://images.gr-assets.com/books/1300411319m/228667.jpg,NULL,eng,fantasy:epic,48.79,"fantasy,prophecy,chosen_one,politics,journey","reluctant_saviour,prophecy,identity","Goodreads (goodbooks-10k)",wheel-of-time
The Last Wish,Andrzej Sapkowski,The Witcher,1,1993,"A monster hunter for hire navigates moral grey areas, cursed creatures, and twisted fairy tales in a world where choices are rarely clean.",0316029178,9780316029176,https://images.gr-assets.com/books/1529591917m/40603587.jpg,NULL,eng,fantasy:sword_and_sorcery,45.68,"fantasy,monster_hunter,short_stories,folklore,sword_and_sorcery","monster_hunter,twisted_fairy_tales,moral_grey","Goodreads (goodbooks-10k)",the-witcher
"The Lion, the Witch, and the Wardrobe",C.S. Lewis,Chronicles of Narnia,1,1950,"Four children enter a magical land trapped in endless winter and join a fight to restore freedom against a tyrannical witch.",0064409429,9780064409421,https://images.gr-assets.com/books/1353029077m/100915.jpg,NULL,eng,fantasy:mythic,86.26,"fantasy,children,portal_world,classic,allegory","portal_fantasy,chosen_children,good_vs_evil","Goodreads (goodbooks-10k)",chronicles-of-narnia
American Gods,Neil Gaiman,NULL,NULL,2001,"A recently released ex-con becomes bodyguard to a mysterious drifter and is pulled into a hidden war between old gods and modern beliefs.",0062572237,9780062572233,https://images.gr-assets.com/books/1462924585m/30165203.jpg,NULL,en-US,fantasy:urban_mythic,58.44,"fantasy,urban,road_trip,mythology,modern_gods","hidden_world,road_trip,myth_reimagining","Goodreads (goodbooks-10k)",NULL
Good Omens,Terry Pratchett,NULL,NULL,1990,"An angel and a demon who have grown fond of Earth team up to avert the apocalypse—despite prophecy, bureaucracy, and a misplaced Antichrist.",0060853980,9780060853983,https://images.gr-assets.com/books/1392528568m/12067.jpg,NULL,eng,fantasy:comic,58.93,"fantasy,apocalypse,humour,angels_and_demons,friendship","unlikely_allies,avert_the_apocalypse,misplaced_chosen_one","Goodreads (goodbooks-10k)",NULL
The Princess Bride,William Goldman,NULL,NULL,1973,"A swashbuckling fairy tale blends romance, revenge, and wit as a farm boy-turned-hero battles impossible odds to rescue his true love.",0156035219,9780156035217,https://images.gr-assets.com/books/1327903636m/21787.jpg,NULL,eng,fantasy:comic,64.57,"fantasy,romance,adventure,swashbuckling,humour","true_love,swashbuckling,revenge_plot","Goodreads (goodbooks-10k)",NULL
The Blade Itself,Joe Abercrombie,The First Law,1,2006,"In a cynical world of politics and violence, a barbarian, a torturer, and a nobleman are drawn into conflict where heroism is scarce and consequences are brutal.",0316387317,9780316387313,https://images.gr-assets.com/books/1327947728m/944073.jpg,NULL,eng,fantasy:grimdark,48.33,"fantasy,grimdark,war,politics,antiheroes","antiheroes,grimdark_world,political_machinations","Goodreads (goodbooks-10k)",the-first-law
The Magicians,Lev Grossman,The Magicians,1,2009,"A disaffected teenager discovers a secret college of magic and learns that fantasy worlds are real—though not as safe or satisfying as imagined.",0452296293,9780452296299,https://images.gr-assets.com/books/1407672850m/6101718.jpg,NULL,eng,fantasy:urban,51.65,"fantasy,urban,academy,portal_world,adult","deconstruction_of_fantasy,magic_school,portal_world","Goodreads (goodbooks-10k)",the-magicians
Harry Potter and the Sorcerer's Stone,J.K. Rowling,Harry Potter,1,1997,"An orphaned boy learns he is a wizard and enters a hidden school of magic, where friendship and a dark mystery begin to shape his life.",0439554934,9780439554930,https://images.gr-assets.com/books/1474154022m/3.jpg,NULL,eng,fantasy:academy,94.78,"fantasy,academy,magic,friendship,coming_of_age","magic_school,chosen_one,found_family","Goodreads (goodbooks-10k)",harry-potter
Harry Potter and the Chamber of Secrets,J.K. Rowling,Harry Potter,2,1998,"Strange attacks and a sinister legend haunt a school of magic, forcing a young wizard to uncover what lies behind a deadly secret chamber.",0439064864,9780439064866,https://images.gr-assets.com/books/1474169725m/15881.jpg,NULL,eng,fantasy:academy,86.83,"fantasy,academy,mystery,magic,friendship","ancient_secret,monster_in_the_school,investigation","Goodreads (goodbooks-10k)",harry-potter
Harry Potter and the Prisoner of Azkaban,J.K. Rowling,Harry Potter,3,1999, "A feared fugitive is said to be hunting a young wizard, but unraveling the truth reveals betrayal, trauma, and unexpected guardianship.",043965548X,9780439655485,https://images.gr-assets.com/books/1499277281m/5.jpg,NULL,eng,fantasy:academy,87.03,"fantasy,academy,thriller,magic,friendship","escaped_prisoner,hidden_truth,found_family","Goodreads (goodbooks-10k)",harry-potter
Harry Potter and the Goblet of Fire,J.K. Rowling,Harry Potter,4,2000,"A dangerous tournament and rising dark forces push a young wizard into lethal trials, culminating in a shocking return of a long-feared enemy.",0439139600,9780439139601,https://images.gr-assets.com/books/1361482611m/6.jpg,NULL,eng,fantasy:academy,86.79,"fantasy,academy,tournament,magic,coming_of_age","deadly_tournament,return_of_evil,coming_of_age","Goodreads (goodbooks-10k)",harry-potter
Harry Potter and the Order of the Phoenix,J.K. Rowling,Harry Potter,5,2003,"As denial and repression spread, a young wizard faces propaganda, resistance, and loss while preparing for a war that is no longer avoidable.",0439358078,9780439358071,https://images.gr-assets.com/books/1387141547m/2.jpg,NULL,eng,fantasy:academy,86.56,"fantasy,academy,resistance,magic,war","resistance_movement,propaganda,mentor_loss","Goodreads (goodbooks-10k)",harry-potter
Harry Potter and the Half-Blood Prince,J.K. Rowling,Harry Potter,6,2005,"Clues from a mysterious textbook and memories of a dark wizard’s past lead toward a looming confrontation—and a devastating betrayal.",0439785960,9780439785969,https://images.gr-assets.com/books/1361039191m/1.jpg,NULL,eng,fantasy:academy,78.75,"fantasy,academy,mystery,magic,war","mysterious_textbook,origin_story,tragic_turn","Goodreads (goodbooks-10k)",harry-potter
Harry Potter and the Deathly Hallows,J.K. Rowling,Harry Potter,7,2007,"On the run and far from school, three friends hunt hidden artefacts that could end a tyrant’s reign, testing courage, loyalty, and sacrifice.",0545010225,9780545010221,https://images.gr-assets.com/books/1474171184m/136251.jpg,NULL,eng,fantasy:academy,86.72,"fantasy,war,quest,friendship,finale","quest_for_relics,final_battle,sacrifice","Goodreads (goodbooks-10k)",harry-potter
Dune,Frank Herbert,Dune,1,1965,"On a desert planet where a vital resource is controlled, a noble family becomes trapped in imperial politics, prophecy, and revolution that could reshape civilisation.",0441172717,9780441172719,https://images.gr-assets.com/books/1434908555m/234225.jpg,NULL,eng,sci-fi:space_opera,74.80,"sci-fi,space_opera,politics,desert_planet,prophecy","messiah_figure,desert_power,imperial_intrigue","Goodreads (goodbooks-10k)",dune
Ender's Game,Orson Scott Card,Ender's Saga,1,1985,"A brilliant child is trained through ruthless simulations to defend humanity from alien threat, only to discover the cost of victory.",0812550706,9780812550702,https://images.gr-assets.com/books/1408303130m/375802.jpg,NULL,eng,sci-fi:military,62.17,"sci-fi,military,training,child_prodigy,alien_war","child_soldier,training_simulations,twist_ending","Goodreads (goodbooks-10k)",enders-saga
Foundation,Isaac Asimov,Foundation,1,1951,"A mathematician predicts the fall of a galactic empire and creates a plan to preserve knowledge, but the future refuses to behave as equations expect.",0553293354,9780553293357,https://images.gr-assets.com/books/1417900846m/29579.jpg,NULL,eng,sci-fi:space_opera,56.43,"sci-fi,space_opera,empire,politics,psychohistory","fall_of_empire,grand_plan,history_as_science","Goodreads (goodbooks-10k)",foundation
"I, Robot",Isaac Asimov,NULL,NULL,1950,"A linked set of stories explores how intelligent machines and their rules could reshape society, revealing unexpected loopholes in seemingly safe constraints.",055338256X,9780553382563,https://images.gr-assets.com/books/1385861606m/41804.jpg,NULL,eng,sci-fi:robotics,55.77,"sci-fi,robots,ai,short_stories,ethics","three_laws,unexpected_consequences,ai_ethics","Goodreads (goodbooks-10k)",NULL
Neuromancer,William Gibson,Sprawl,1,1984,"A washed-up hacker is hired for an impossible cyber heist, plunging into AI intrigue, corporate power, and a gritty near-future underworld.",0441569595,9780441569595,https://images.gr-assets.com/books/1304479733m/6088007.jpg,NULL,eng,sci-fi:cyberpunk,47.20,"sci-fi,cyberpunk,hacking,ai,corporations","cyber_heist,ai_awakening,corporate_control","Goodreads (goodbooks-10k)",sprawl
Snow Crash,Neal Stephenson,NULL,NULL,1992,"A pizza-delivering hacker and a skateboard courier uncover a conspiracy that spans virtual reality, corporate states, and a mind-altering information virus.",0553380958,9780553380955,https://images.gr-assets.com/books/1477623860m/40651883.jpg,NULL,eng,sci-fi:cyberpunk,54.71,"sci-fi,cyberpunk,virtual_reality,conspiracy,hackers","virtual_reality_world,infohazard,corporate_states","Goodreads (goodbooks-10k)",NULL
The Martian,Andy Weir,NULL,NULL,2011,"An astronaut stranded on Mars improvises science and grit to survive alone, while Earth scrambles to mount a rescue against impossible odds.",0804139024,9780804139021,https://images.gr-assets.com/books/1413706054m/18007564.jpg,NULL,eng,sci-fi:hard_sf,64.27,"sci-fi,hard_sf,survival,mars,problem_solving","castaway_on_mars,ingenuity_against_odds,science_problem_solving","Goodreads (goodbooks-10k)",NULL
Ready Player One,Ernest Cline,NULL,NULL,2011,"In a dystopian future, a teenager hunts for a hidden prize inside a vast virtual world, navigating corporate threats and pop-culture riddles.",0307887448,9780307887443,https://images.gr-assets.com/books/1500930947m/9969571.jpg,NULL,eng,sci-fi:virtual_reality,61.48,"sci-fi,virtual_reality,dystopian,gaming,nostalgia","virtual_treasure_hunt,corporate_villain,nostalgia_bomb","Goodreads (goodbooks-10k)",NULL
Leviathan Wakes,James S.A. Corey,The Expanse,1,2011,"A missing girl and a polluted conspiracy draw a detective and a spaceship crew into a crisis that threatens peace across the solar system.",0316129083,9780316129081,https://images.gr-assets.com/books/1411013134m/8855321.jpg,NULL,eng,sci-fi:space_opera,42.16,"sci-fi,space_opera,mystery,politics,solar_system","noir_detective_in_space,conspiracy,first_contact_element","Goodreads (goodbooks-10k)",the-expanse
The Three-Body Problem,Cixin Liu,Remembrance of Earth's Past,1,2006,"A secret first-contact project and a modern investigation collide, as humanity confronts an alien civilisation and the unsettling physics behind their arrival.",0765377063,9780765377062,https://images.gr-assets.com/books/1333578746m/20518872.jpg,NULL,eng,sci-fi:hard_sf,42.83,"sci-fi,hard_sf,first_contact,physics,alien_civilisation","first_contact,scientific_mystery,existential_threat","Goodreads (goodbooks-10k)",remembrance-of-earths-past
Fahrenheit 451,Ray Bradbury,NULL,NULL,1953,"In a society that burns books to enforce shallow happiness, a fireman begins to question his role and risks everything to preserve ideas.",1451673310,9781451673319,https://images.gr-assets.com/books/1351643740m/17470674.jpg,NULL,eng,sci-fi:dystopian,72.43,"sci-fi,dystopian,censorship,books,resistance","book_burning,awakening,rebellion","Goodreads (goodbooks-10k)",NULL
Brave New World,Aldous Huxley,NULL,NULL,1932,"A seemingly perfect future society built on conditioning and pleasure begins to crack when individuals confront love, art, and meaning.",0060850523,9780060850524,https://images.gr-assets.com/books/1575509280m/5129.jpg,NULL,eng,sci-fi:dystopian,77.08,"sci-fi,dystopian,social_control,biotech,philosophical","engineered_society,pleasure_control,outsider","Goodreads (goodbooks-10k)",NULL
1984,George Orwell,NULL,NULL,1949,"A totalitarian regime controls truth itself, and one man’s quiet rebellion becomes a dangerous gamble against surveillance and enforced reality.",0451524934,9780451524935,https://images.gr-assets.com/books/1348990566m/5470.jpg,NULL,eng,sci-fi:dystopian,86.99,"sci-fi,dystopian,totalitarianism,surveillance,rebellion","surveillance_state,thoughtcrime,forbidden_love","Goodreads (goodbooks-10k)",NULL
The Handmaid's Tale,Margaret Atwood,NULL,NULL,1985,"In a theocratic dictatorship that controls women’s bodies, a captive handmaid struggles to survive, remember, and resist in small, risky ways.",038549081X,9780385490818,https://images.gr-assets.com/books/1498057733m/38447.jpg,NULL,eng,sci-fi:dystopian,73.64,"sci-fi,dystopian,theocracy,gender,oppression","theocracy,oppression,resistance","Goodreads (goodbooks-10k)",NULL
The Hitchhiker's Guide to the Galaxy,Douglas Adams,The Hitchhiker's Guide to the Galaxy,1,1979,"After Earth is unexpectedly destroyed, an ordinary man is swept into absurd cosmic adventures guided by a weirdly practical galactic travel guide.",0345391802,9780345391803,https://images.gr-assets.com/books/1327656754m/386162.jpg,NULL,eng,sci-fi:comic,74.42,"sci-fi,comedy,space,absurdism,adventure","absurdist_quest,fish_out_of_water,space_road_trip","Goodreads (goodbooks-10k)",the-hitchhikers-guide-to-the-galaxy
```

## Instructions for Claude or a developer to complete the full 5,000‑row CSV

### Implementation steps Claude should follow

#### Build the 5,000 candidate list
1. **Start from a popularity-ranked base** (e.g., a Goodreads-derived popularity dataset such as Goodbooks‑10k, which is explicitly “most popular (with most ratings)”). citeturn1view0turn2view0  
2. Filter to **English books** and **sci‑fi/fantasy**:
   - Prefer “genre shelves/tags” mappings where available.
   - Add missing canonical works from awards lists and publisher/community lists (store each in `source_list`).

#### Enrich metadata through APIs in this order
Use “progressive enrichment” to reduce paid calls:

1. **Open Library Search API**  
   - Use `https://openlibrary.org/search.json` for batch retrieval and to obtain work-level and edition-level metadata. citeturn14view0  
   - Respect published expectations: cache, identify your app via `User-Agent`, and follow rate limits (1 rps default; 3 rps identified). citeturn6view0  

2. **Open Library Covers API**  
   - Construct cover URLs using the documented pattern; avoid crawling and respect rate limiting. citeturn13view0  

3. **Google Books API**  
   - Use it to fill `page_count`, `description`, and sometimes categories; requests typically require an API key unless using OAuth. citeturn5search1  

4. **ISBNdb API**  
   - Use to fill holes when you have ISBNs but are missing page counts, subtitle/description, etc. citeturn5search6turn5search10  

5. **WorldCat Search API**  
   - Use for holdings-based popularity signals and disambiguation when possible. citeturn5search11turn5search3  

#### Merging rules (critical)
Claude should implement deterministic rules so the seed is reproducible:

- Prefer identifiers in this order for “same work” matching: `isbn_13` → `isbn_10` → Open Library Work ID → Google Books volume ID → fuzzy `(title+author)`.  
- If multiple editions: pick the edition with (a) most complete metadata, then (b) highest popularity signal, then (c) most common ISBN13.  
- Series normalisation: store one canonical `series_name` per series, with stable `series_id`, and integer `series_order` when known.

### Rate-limit and attribution guidance
- Open Library: cache responses; include contact info in `User-Agent`; stay within documented rate limits; do not bulk-harvest via API. citeturn6view0  
- Open Library covers: do not crawl; use the `covers.openlibrary.org` host for display; note rate limiting for key types and use bulk downloads if needed. citeturn13view0  
- Google Books / WorldCat / ISBNdb: treat them as contractual data sources—log requests, store `source_list`, store API-specific IDs where possible, and keep an internal “attribution” page in-app. citeturn5search1turn5search11turn5search6  

## Next steps

1. Confirm whether your production app is commercial; if yes, decide which datasets/sources are acceptable under licensing and ToS (Goodbooks‑10k is CC BY‑SA). citeturn2view0  
2. Have Claude (or your developer) implement the **candidate → dedupe → enrich → score → export** pipeline exactly as described above.  
3. Re-run the same “counts by subgenre” report on the resulting 5,000 rows and lock the subgenre vocabulary so your 3D universe regions remain stable as you add more books.  
4. Once the 5,000-row CSV exists, you can immediately proceed to building embeddings + 3D projection knowing your base metadata and series graph are consistent.
/**
 * AniWiki Backend Server (Node.js + Express)
 * ------------------------------------------------------------
 * - Serves the clean frontend (index.html)
 * - Hides all GraphQL queries, API endpoints, and caching logic on the server
 * - Exposes clean REST endpoints (/api/*) for the browser
 *
 * Setup & Run:
 *   npm init -y
 *   npm install express
 *   node server.js
 */

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ANILIST_ENDPOINT = 'https://graphql.anilist.co';

app.use(express.json());

// In-memory cache (5 minutes TTL) to make responses fast & avoid rate limits
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function queryAniList(query, variables = {}) {
    const cacheKey = JSON.stringify({ query, variables });
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.data;
    }

    const response = await fetch(ANILIST_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({ query, variables })
    });

    const json = await response.json();
    if (!response.ok || json.errors) {
        throw new Error(json.errors?.[0]?.message || 'Upstream Data Error');
    }

    cache.set(cacheKey, { data: json.data, timestamp: Date.now() });
    return json.data;
}

// 1. All Anime Encyclopedia Endpoint
app.get('/api/anime', async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const sort = req.query.sort || 'POPULARITY_DESC';
        const variables = { page, sort: [sort] };

        if (req.query.search) variables.search = req.query.search;
        if (req.query.genre) variables.genre = req.query.genre;
        if (req.query.year) variables.seasonYear = parseInt(req.query.year, 10);
        if (req.query.status) variables.status = req.query.status;

        const query = `
      query ($page: Int, $search: String, $sort: [MediaSort], $genre: String, $seasonYear: Int, $status: MediaStatus) {
        Page(page: $page, perPage: 20) {
          pageInfo { hasNextPage }
          media(type: ANIME, isAdult: false, search: $search, sort: $sort, genre: $genre, seasonYear: $seasonYear, status: $status) {
            id
            title { romaji english native }
            coverImage { extraLarge large }
            format
            status
            episodes
            seasonYear
            averageScore
            genres
            startDate { year month day }
            endDate { year month day }
            studios(isMain: true) { nodes { name } }
          }
        }
      }
    `;

        const data = await queryAniList(query, variables);
        res.json(data.Page);
    } catch (err) {
        res.status(502).json({ error: err.message });
    }
});

// 2. Upcoming & Auto-Detection Radar Endpoint
app.get('/api/upcoming', async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const mode = req.query.mode || 'NEWLY_ANNOUNCED';
        const type = mode === 'UPCOMING_MANGA' ? 'MANGA' : 'ANIME';
        const status = mode === 'RELEASING' ? 'RELEASING' : 'NOT_YET_RELEASED';

        let sort = ['POPULARITY_DESC'];
        if (mode === 'NEWLY_ANNOUNCED' || mode === 'UPCOMING_MANGA') {
            sort = ['ID_DESC'];
        } else if (mode === 'RELEASING') {
            sort = ['TRENDING_DESC'];
        }

        const query = `
      query ($page: Int, $type: MediaType, $status: MediaStatus, $sort: [MediaSort]) {
        Page(page: $page, perPage: 15) {
          pageInfo { hasNextPage }
          media(type: $type, isAdult: false, status: $status, sort: $sort) {
            id
            type
            title { romaji english }
            coverImage { large }
            bannerImage
            format
            status
            episodes
            chapters
            season
            seasonYear
            genres
            startDate { year month day }
            nextAiringEpisode { episode timeUntilAiring }
            studios(isMain: true) { nodes { name } }
            relations {
              edges {
                relationType(version: 2)
                node { type title { english romaji } }
              }
            }
            externalLinks { site url type }
          }
        }
      }
    `;

        const data = await queryAniList(query, { page, type, status, sort });
        res.json(data.Page);
    } catch (err) {
        res.status(502).json({ error: err.message });
    }
});

// 3. Manga & Light Novel Encyclopedia Endpoint
app.get('/api/manga', async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const sort = req.query.sort || 'POPULARITY_DESC';
        const variables = { page, sort: [sort] };

        if (req.query.search) variables.search = req.query.search;
        if (req.query.genre) variables.genre = req.query.genre;
        if (req.query.format) variables.format = req.query.format;
        if (req.query.status) variables.status = req.query.status;

        const query = `
      query ($page: Int, $search: String, $sort: [MediaSort], $genre: String, $format: MediaFormat, $status: MediaStatus) {
        Page(page: $page, perPage: 20) {
          pageInfo { hasNextPage }
          media(type: MANGA, isAdult: false, search: $search, sort: $sort, genre: $genre, format: $format, status: $status) {
            id
            type
            title { romaji english native }
            coverImage { extraLarge large }
            format
            status
            chapters
            volumes
            averageScore
            genres
            startDate { year month day }
          }
        }
      }
    `;

        const data = await queryAniList(query, variables);
        res.json(data.Page);
    } catch (err) {
        res.status(502).json({ error: err.message });
    }
});

// 4. Characters A-Z Directory Endpoint
app.get('/api/characters', async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const search = req.query.search || null;

        const query = `
      query ($page: Int, $search: String) {
        Page(page: $page, perPage: 24) {
          pageInfo { hasNextPage }
          characters(search: $search, sort: [FAVOURITES_DESC]) {
            id
            name { full native }
            image { large }
            favourites
            media(perPage: 1, sort: [POPULARITY_DESC]) {
              nodes {
                title { romaji english }
              }
            }
          }
        }
      }
    `;

        const data = await queryAniList(query, { page, search });
        res.json(data.Page);
    } catch (err) {
        res.status(502).json({ error: err.message });
    }
});

// 5. Random Anime Discovery Endpoint
app.get('/api/random', async (req, res) => {
    try {
        const randomPage = Math.floor(Math.random() * 120) + 1;
        const query = `
      query ($page: Int) {
        Page(page: $page, perPage: 20) {
          media(type: ANIME, isAdult: false, sort: [POPULARITY_DESC]) {
            id
          }
        }
      }
    `;
        const data = await queryAniList(query, { page: randomPage });
        const list = data.Page.media || [];
        const pick = list[Math.floor(Math.random() * list.length)];
        res.json({ id: pick?.id || 154587 });
    } catch (err) {
        res.status(502).json({ error: err.message });
    }
});

// 6. Full Wikipedia Detail Modal Endpoint (Anime or Manga)
app.get('/api/media/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const query = `
      query ($id: Int) {
        Media(id: $id) {
          id
          type
          title { romaji english native }
          coverImage { extraLarge large }
          bannerImage
          format
          status
          episodes
          chapters
          volumes
          duration
          season
          seasonYear
          averageScore
          popularity
          genres
          source
          description(asHtml: false)
          startDate { year month day }
          endDate { year month day }
          nextAiringEpisode { episode timeUntilAiring }
          studios(isMain: true) { nodes { name } }
          staff(perPage: 4, sort: [RELEVANCE]) {
            edges {
              role
              node { name { full } }
            }
          }
          externalLinks { site url type }
          relations {
            edges {
              relationType(version: 2)
              node {
                id
                type
                title { romaji english }
                format
                status
                episodes
                chapters
                seasonYear
                coverImage { medium }
              }
            }
          }
          characters(perPage: 25, sort: [ROLE, RELEVANCE]) {
            edges {
              role
              node {
                id
                name { full native }
                image { medium }
              }
              voiceActors(language: JAPANESE, sort: [RELEVANCE]) {
                name { full }
              }
            }
          }
        }
      }
    `;

        const data = await queryAniList(query, { id });
        res.json(data.Media);
    } catch (err) {
        res.status(502).json({ error: err.message });
    }
});

// 7. Character Biography & Voice Actors Endpoint
app.get('/api/character/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const query = `
      query ($id: Int) {
        Character(id: $id) {
          id
          name { full native alternative }
          image { large }
          description(asHtml: false)
          gender
          age
          bloodType
          dateOfBirth { year month day }
          favourites
          media(perPage: 8, sort: [POPULARITY_DESC]) {
            edges {
              characterRole
              voiceActors(sort: [LANGUAGE, RELEVANCE]) {
                languageV2
                name { full }
              }
              node {
                id
                type
                title { romaji english }
                seasonYear
                coverImage { medium }
              }
            }
          }
        }
      }
    `;

        const data = await queryAniList(query, { id });
        res.json(data.Character);
    } catch (err) {
        res.status(502).json({ error: err.message });
    }
});

// Serve Frontend HTML File (Catch-all for SPA)
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'aniwiki.html'));
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`AniWiki Full-Stack Server running at http://localhost:${PORT}`);
    });
}

module.exports = app;

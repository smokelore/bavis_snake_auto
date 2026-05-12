import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { list, put } from '@vercel/blob';

const buildScoresFile = path.join(process.cwd(), 'api', 'scores-data.json');
const runtimeScoresFile = path.join(os.tmpdir(), 'scores-data.json');
const blobScorePrefix = 'scores/';
const hasBlobStorage = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

function ensureScoresFile() {
    if (!fs.existsSync(runtimeScoresFile)) {
        if (fs.existsSync(buildScoresFile)) {
            try {
                fs.copyFileSync(buildScoresFile, runtimeScoresFile);
            } catch (e) {
                console.error('Could not copy build score file to runtime tmp:', e);
            }
        } else {
            try {
                fs.writeFileSync(runtimeScoresFile, '[]');
            } catch (e) {
                console.error('Could not create runtime score file:', e);
            }
        }
    }
    return runtimeScoresFile;
}

function normalizeScores(scores) {
    if (!Array.isArray(scores)) return [];

    return scores
        .filter(entry => entry && typeof entry.name === 'string' && Number.isFinite(entry.score))
        .map(entry => ({
            id: entry.id || randomUUID(),
            name: entry.name.substring(0, 20).trim(),
            score: Math.max(0, Math.floor(entry.score)),
            date: entry.date || new Date().toISOString()
        }))
        .filter(entry => entry.name);
}

function topScores(scores, limit = 10) {
    return normalizeScores(scores)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

function createScoreEntry(name, score) {
    return {
        id: randomUUID(),
        name: name.substring(0, 20).trim(),
        score: Math.max(0, Math.floor(score)),
        date: new Date().toISOString()
    };
}

function readLocalScores() {
    const currentFile = ensureScoresFile();

    try {
        const data = fs.readFileSync(currentFile, 'utf8');
        return normalizeScores(JSON.parse(data || '[]'));
    } catch (e) {
        return [];
    }
}

function writeLocalScores(scores) {
    fs.writeFileSync(runtimeScoresFile, JSON.stringify(topScores(scores, 100), null, 2));
}

async function readBlobScores() {
    const { blobs } = await list({
        prefix: blobScorePrefix,
        limit: 1000
    });

    const scores = await Promise.all(
        blobs.map(async blob => {
            try {
                const response = await fetch(blob.downloadUrl || blob.url, { cache: 'no-store' });
                if (!response.ok) return null;
                return await response.json();
            } catch (e) {
                console.error('Could not read blob score:', e);
                return null;
            }
        })
    );

    return normalizeScores(scores);
}

async function writeBlobScore(entry) {
    await put(
        `${blobScorePrefix}${entry.date}-${entry.id}.json`,
        JSON.stringify(entry),
        {
            access: 'public',
            contentType: 'application/json'
        }
    );
}

async function readScores() {
    if (!hasBlobStorage) {
        return readLocalScores();
    }

    return readBlobScores();
}

async function saveScore(entry) {
    if (!hasBlobStorage) {
        const scores = readLocalScores();
        scores.push(entry);
        writeLocalScores(scores);
        return topScores(scores, 10);
    }

    await writeBlobScore(entry);
    const scores = await readBlobScores();
    if (!scores.some(score => score.id === entry.id)) {
        scores.push(entry);
    }
    return topScores(scores, 10);
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        if (req.method === 'GET') {
            const scores = await readScores();
            return res.status(200).json(topScores(scores, 10));
        }

        if (req.method === 'POST') {
            const { name, score } = req.body;

            if (!name || typeof score !== 'number') {
                return res.status(400).json({ error: 'Invalid name or score' });
            }

            const entry = createScoreEntry(name, score);
            if (!entry.name) {
                return res.status(400).json({ error: 'Invalid name or score' });
            }

            const scores = await saveScore(entry);

            return res.status(200).json({
                success: true,
                scores
            });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
}

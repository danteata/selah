import { parseRTF, extractVerseStructureFromRTF } from '../src/services/migration/rtfParser'
import { execSync } from 'child_process'
import * as fs from 'fs'

const CWD = '/Users/danielabakah/code/JS/selah'

// Dump only the IDs + titles (no RTF) to avoid newlines-in-data issues
const idTitleTsv = '/tmp/songs_ids.tsv'
execSync(
  `sqlite3 -separator $'\t' SongWords.db "ATTACH 'Songs.db' AS songs; SELECT w.song_id, s.title FROM word w JOIN songs.song s ON s.rowid = w.song_id WHERE LENGTH(w.words) > 0" > ${idTitleTsv}`,
  { cwd: CWD, stdio: 'ignore' }
)

const idTitleRaw = fs.readFileSync(idTitleTsv, 'utf-8')
const idTitleLines = idTitleRaw.split('\n').filter(Boolean)

interface Row { song_id: number; title: string; words: string }
const rows: Row[] = idTitleLines.map((line) => {
  const tab = line.indexOf('\t')
  return {
    song_id: parseInt(line.slice(0, tab), 10),
    title: line.slice(tab + 1),
    words: '', // filled in below
  }
})

console.log(`Total songs: ${rows.length}`)

interface Issue {
  song_id: number
  title: string
  kind: string
  detail: string
}
const issues: Issue[] = []
const verseCountBySong = new Map<number, number>()
const textLengthBySong = new Map<number, number>()
let floatLeaks = 0
let emptyOutputs = 0
let rtfResidueCount = 0
let labelInContentCount = 0
let longWithoutBreaksCount = 0
let slideLabelInLyrics = 0
let parseErrors = 0

for (const row of rows) {
  // Pull each song's RTF separately — no embedded-newline issues.
  const rtfPath = `/tmp/rtf_${row.song_id}.txt`
  try {
    execSync(
      `sqlite3 SongWords.db "SELECT writefile('${rtfPath}', words) FROM word WHERE song_id = ${row.song_id}"`,
      { cwd: CWD, stdio: 'ignore' }
    )
  } catch {
    issues.push({ song_id: row.song_id, title: row.title, kind: 'db-read', detail: 'failed to read RTF' })
    continue
  }
  const rtf = fs.readFileSync(rtfPath, 'utf-8')
  fs.unlinkSync(rtfPath)

  try {
    const text = parseRTF(rtf)
    const verses = extractVerseStructureFromRTF(rtf)

    verseCountBySong.set(row.song_id, verses.length)
    textLengthBySong.set(row.song_id, text.length)

    const floats = text.match(/\d+\.\d{4,}/g)
    if (floats) {
      floatLeaks++
      issues.push({ song_id: row.song_id, title: row.title, kind: 'float-leak', detail: floats.slice(0, 3).join(', ') })
    }

    if (text.trim().length === 0) {
      emptyOutputs++
      issues.push({ song_id: row.song_id, title: row.title, kind: 'empty', detail: 'parseRTF returned empty string' })
    }

    const rtfResidue = text.match(/\\[a-zA-Z]+\d*\s?/g)
    if (rtfResidue) {
      rtfResidueCount++
      issues.push({ song_id: row.song_id, title: row.title, kind: 'rtf-residue', detail: rtfResidue.slice(0, 3).join(', ') })
    }

    if (verses.length === 1 && !verses[0].label) {
      const labelInContent = text.match(/^(Verse|Chorus|Bridge|Tag|Pre-Chorus|Intro|Outro|Ending)\s*\d*\s*$/im)
      if (labelInContent) {
        labelInContentCount++
        issues.push({ song_id: row.song_id, title: row.title, kind: 'label-in-content', detail: 'verse labels in content but not extracted' })
      }
    }

    if (text.length > 50 && !text.includes('\n')) {
      longWithoutBreaksCount++
      issues.push({ song_id: row.song_id, title: row.title, kind: 'no-newlines', detail: `${text.length} chars without line break` })
    }

    // "Slide N" appearing as visible text in the raw parseRTF output.
    // (The lyrics field goes through parseRTFForLyrics which strips
    // these, so this counter measures raw-parser artifacts only.)
    if (/\bSlide\s+\d+\b/.test(text)) {
      const slideLabels = text.match(/\bSlide\s+\d+\b/g)
      if (slideLabels) {
        slideLabelInLyrics++
        issues.push({
          song_id: row.song_id,
          title: row.title,
          kind: 'slide-label',
          detail: `${slideLabels.length} "Slide N" label(s) appearing as lyrics`,
        })
      }
    }

    // Simulate what the import wizard stores in the `lyrics` field —
    // goes through parseRTFForLyrics (see easyWorshipParser.ts). Any
    // Slide N labels still appearing here are a regression.
    const lyricsField = text
      .replace(/\n?---SLIDE---\n?/g, '\n')
      .replace(/^Slide\s+\d+\s*$/gim, '')
      .replace(/^Repeat\s*$/gim, '')
    if (/\bSlide\s+\d+\b/.test(lyricsField)) {
      issues.push({
        song_id: row.song_id,
        title: row.title,
        kind: 'lyrics-still-has-slide',
        detail: 'parseRTFForLyrics failed to strip Slide N label',
      })
    }
  } catch (err) {
    parseErrors++
    issues.push({ song_id: row.song_id, title: row.title, kind: 'parse-error', detail: String(err) })
  }
}

const verseCounts = [...verseCountBySong.values()]
const sorted = [...verseCounts].sort((a, b) => a - b)
const median = sorted[Math.floor(sorted.length / 2)]
const p95 = sorted[Math.floor(sorted.length * 0.95)]
const max = sorted[sorted.length - 1]
const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length

console.log('\n=== Verse count distribution ===')
console.log(`mean: ${mean.toFixed(2)}, median: ${median}, p95: ${p95}, max: ${max}`)
console.log(`Distribution: 1=${verseCounts.filter((v) => v === 1).length}, 2-5=${verseCounts.filter((v) => v >= 2 && v <= 5).length}, 6-10=${verseCounts.filter((v) => v >= 6 && v <= 10).length}, 11-20=${verseCounts.filter((v) => v >= 11 && v <= 20).length}, 21+=${verseCounts.filter((v) => v > 20).length}`)

console.log('\n=== Issue counts ===')
console.log(`float leaks (e.g. 48.5999984741211):     ${floatLeaks}`)
console.log(`empty parseRTF output:                 ${emptyOutputs}`)
console.log(`RTF residue in output:                 ${rtfResidueCount}`)
console.log(`labels in content but not extracted:  ${labelInContentCount}`)
console.log(`long text without newlines:            ${longWithoutBreaksCount}`)
console.log(`"Slide N" labels appearing as lyrics:  ${slideLabelInLyrics}`)
console.log(`parse errors:                          ${parseErrors}`)

console.log('\n=== Songs with 20+ verses (likely over-split) ===')
let overSplit = 0
for (const row of rows) {
  const count = verseCountBySong.get(row.song_id)
  if (count === undefined) continue
  if (count > 20) {
    overSplit++
    if (overSplit <= 20) {
      console.log(`  #${row.song_id} "${row.title}" -> ${count} verses`)
    }
  }
}
console.log(`Total over-split: ${overSplit}`)

console.log('\n=== Issues by kind (top 5 of each) ===')
const byKind: Record<string, Issue[]> = {}
for (const iss of issues) {
  (byKind[iss.kind] ||= []).push(iss)
}
for (const [kind, list] of Object.entries(byKind)) {
  console.log(`\n[${kind}] (${list.length}):`)
  list.slice(0, 5).forEach((iss) => {
    console.log(`  #${iss.song_id} "${iss.title}": ${iss.detail}`)
  })
  if (list.length > 5) console.log(`  ... and ${list.length - 5} more`)
}

fs.unlinkSync(idTitleTsv)

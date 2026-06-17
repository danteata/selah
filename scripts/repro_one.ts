import { parseRTF, extractVerseStructureFromRTF } from '../src/services/migration/rtfParser'
import { execSync } from 'child_process'
import * as fs from 'fs'

const CWD = '/Users/danielabakah/code/JS/selah'

const idTitleTsv = '/tmp/songs_ids3.tsv'
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
    words: '',
  }
})

console.log(`Total songs: ${rows.length}`)

const targetIdx = rows.findIndex(r => r.song_id === 3052)
console.log(`Target idx: ${targetIdx}, title: ${rows[targetIdx]?.title}`)

const row = rows[targetIdx]
const rtfPath = `/tmp/rtf_${row.song_id}.txt`
execSync(`sqlite3 SongWords.db "SELECT writefile('${rtfPath}', words) FROM word WHERE song_id = ${row.song_id}"`, { cwd: CWD, stdio: 'ignore' })
const rtf = fs.readFileSync(rtfPath, 'utf-8')
fs.unlinkSync(rtfPath)
fs.unlinkSync(idTitleTsv)

console.log(`RTF length: ${rtf.length}`)
const verses = extractVerseStructureFromRTF(rtf)
console.log(`Verses: ${verses.length}`)
verses.slice(0, 5).forEach((v, i) => {
  console.log(`  [${i + 1}] "${v.label}": ${v.content.split('\n')[0]?.substring(0, 60)}`)
})

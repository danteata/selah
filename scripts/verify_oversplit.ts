import { extractVerseStructureFromRTF } from '../src/services/migration/rtfParser'
import { execSync } from 'child_process'
import * as fs from 'fs'

const CWD = '/Users/danielabakah/code/JS/selah'
const ids = [3058, 1570, 3264, 3421, 3456, 3457, 3475, 3476, 3271, 3557, 3588, 3634, 3658, 3694, 3695, 3703, 3732, 3781, 3796, 3813]

for (const id of ids) {
  const rtfPath = `/tmp/rtf_${id}.txt`
  execSync(`sqlite3 SongWords.db "SELECT writefile('${rtfPath}', words) FROM word WHERE song_id = ${id}"`, { cwd: CWD, stdio: 'ignore' })
  const rtf = fs.readFileSync(rtfPath, 'utf-8')
  fs.unlinkSync(rtfPath)
  const verses = extractVerseStructureFromRTF(rtf)
  const labels = verses.map((v) => v.label)
  const unique = Array.from(new Set(labels.map((l) => l.replace(/\d+$/, ''))))
  const sample = verses.slice(0, 2).map((v) => v.content.split('\n')[0]?.substring(0, 50) || '').join(' || ')
  console.log(`#${id} ${verses.length}v [${unique.join(',')}] ${sample}`)
}

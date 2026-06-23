import { extractVerseStructureFromRTF, parseRTF } from '../src/services/migration/rtfParser'
import { execSync } from 'child_process'
import * as fs from 'fs'

const CWD = '/Users/danielabakah/code/JS/selah'
const rtfPath = '/tmp/rtf_3052.txt'
execSync(`sqlite3 SongWords.db "SELECT writefile('${rtfPath}', words) FROM word WHERE song_id = 3052"`, { cwd: CWD, stdio: 'ignore' })
const rtf = fs.readFileSync(rtfPath, 'utf-8')
fs.unlinkSync(rtfPath)
console.log('RTF length:', rtf.length)
const verses = extractVerseStructureFromRTF(rtf)
console.log('Verses:', verses.length)
verses.slice(0, 5).forEach((v, i) => {
  console.log(`  [${i + 1}] "${v.label}": ${v.content.split('\n')[0]?.substring(0, 60)}`)
})

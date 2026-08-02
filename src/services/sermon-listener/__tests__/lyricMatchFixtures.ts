/**
 * Real mis-transcriptions of sung lyrics, captured from live runs.
 *
 * Source: two sessions playing Chris Tomlin's "How Great Is Our God" through
 * system audio into `parakeet-unified-en-0.6b`, logged via
 * `[useSermonListener] onResult`. These are verbatim engine output, not
 * invented examples — the whole point is to tune matching against the errors
 * this pipeline actually makes rather than the ones we imagine it makes.
 *
 * `heard` is what the engine produced; `sung` is the lyric line it covers.
 * Some entries carry a rolling window's worth of neighbouring words, because
 * that is what the matcher is really handed at runtime.
 */
export interface LyricFixture {
    sung: string
    heard: string
    /** Notes on what the engine did to it, for whoever reads a failure. */
    note: string
}

export const HOW_GREAT_LINES = [
    'The splendour of a King',
    'Clothed in Majesty',
    'Let all the earth rejoice',
    'All the earth rejoice',
    'He wraps Himself in light',
    'And darkness tries to hide',
    'And trembles at His voice',
    'Trembles at His voice',
    'How great is our God',
    'Sing with me, how great is our God',
    'And all will see how great',
    'Age to age, He stands',
    'And time is in His hands',
    'Beginning and the end',
    'The Godhead, three in one',
    'Father, Spirit, Son',
    'The Lion and the Lamb',
]

/** Cases the matcher should recover — the sound survived even where the
 *  spelling did not. */
export const RECOVERABLE: LyricFixture[] = [
    {
        sung: 'The splendour of a King',
        heard: 'the splendor of a key',
        note: 'British/US spelling plus King -> key',
    },
    {
        sung: 'Clothed in Majesty',
        heard: 'cloth and majesty',
        note: 'word boundary shifted: "clothed in" -> "cloth and"',
    },
    {
        sung: 'And darkness tries to hide',
        heard: 'and darkness tried to hide',
        note: 'tense error only',
    },
    {
        sung: 'And trembles at His voice',
        heard: 'it trembles at his voice trembles at his voice',
        note: 'leading word wrong, line then repeated in one segment',
    },
    {
        sung: 'Trembles at His voice',
        heard: 'trembles at his fall',
        note: 'voice -> fall',
    },
    {
        sung: 'Let all the earth rejoice',
        heard: 'your futures all the earth rebs herself',
        note: 'opening destroyed, "all the earth" intact, rejoice -> rebs',
    },
    {
        sung: 'And time is in His hands',
        heard: 'and time is in the ache',
        note: 'His hands -> the ache',
    },
    {
        sung: 'Father, Spirit, Son',
        heard: 'father spirit and son the lion lion',
        note: 'mostly correct, runs into the next line',
    },
    {
        sung: 'The Lion and the Lamb',
        heard: 'follow the lion lion',
        note: 'Lamb dropped, Lion doubled',
    },
    {
        sung: 'Sing with me, how great is our God',
        heard: 'sing with me how to break this our God and all the sea how great',
        note: 'great -> to break, will see -> the sea',
    },
    {
        sung: 'And all will see how great',
        heard: 'cause I got all will see how great and crazy',
        note: 'core intact, wrapped in invented words either side',
    },
]

/** Cases no lexical or phonetic matcher can recover — the words are simply
 *  gone. These exist to keep us honest about the ceiling: they are what the
 *  position prior has to carry, not the scorer. */
export const UNRECOVERABLE: LyricFixture[] = [
    { sung: 'How great is our God', heard: 'how crazy', note: 'great -> crazy, rest dropped' },
    { sung: 'How great is our God', heard: 'how r', note: 'line reduced to two characters' },
    { sung: 'How great is our God', heard: "it's our", note: 'only the function words survived' },
    { sung: 'He wraps Himself in light', heard: 'in life', note: 'line reduced to two words' },
]

/**
 * Lines from *other* songs that must NOT match the transcript above. A looser
 * scorer buys recall with precision, and precision is what stops an unrelated
 * song reaching the projector — so every recall gain has to be checked against
 * these.
 */
export const DECOYS: string[] = [
    "oh oh Jesus, I'm so in love with You drive me crazy, can't stop thinking about You",
    'yeah yeah (yeah yeah)',
    'I could sing of Your love forever',
    'Blessed be Your name when the sun is shining down on me',
    'Here I am to worship, here I am to bow down',
    'Amazing grace how sweet the sound that saved a wretch like me',
    'Great is Thy faithfulness, morning by morning new mercies I see',
    'Your tender mercies I see day after day',
]

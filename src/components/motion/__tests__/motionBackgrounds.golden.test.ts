import { describe, it } from 'vitest'
import { expectGolden, goldenCanvas } from '../../../test/golden/golden'
import { MOTION_BACKGROUNDS, motionSeed, seededRandom } from '../motionBackgrounds'

// Each scene is a pure function of its seed and the time, so these are exact:
// any pixel that moves is a change to how the background looks. Drawn at
// t = 12 s, the frame `MotionCanvas` shows when it is still (thumbnails, the
// "Next" preview). Retired backgrounds stay covered: existing templates use them.
// Quarter-HD: the scenes are soft gradients and noise, which compress badly, and
// this is plenty to see a change.
const W = 320
const H = 180

describe('motion backgrounds', () => {
    it.each(MOTION_BACKGROUNDS.map((m) => [m.id, m] as const))('%s at t=12s', async (id, motion) => {
        const canvas = goldenCanvas(W, H)
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('no 2d context')
        const state = motion.scene.setup(W, H, seededRandom(motionSeed(id)))
        motion.scene.draw(ctx, W, H, 12, state)
        await expectGolden(`motion-${id}`, canvas, 'exact')
    })
})

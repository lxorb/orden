import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Vitest's default is five seconds, which is a wall-clock budget and nothing
    // else. A handful of these tests do a great deal of honest work against the
    // real SQL - the ceilings in particular make a couple of hundred notes and
    // then share every one of them, one request at a time, because what they are
    // about is the number the service refuses at. Alone that is a second or two;
    // run beside the rest of the suite over whatever cores are left, five seconds
    // is close enough to fail a test that has found nothing wrong. The counts and
    // the statuses they assert are what says whether they are right, and none of
    // them is about how long anything took.
    testTimeout: 30000,
    // And the same for the setup they share: every file builds a database and runs
    // every migration into it in `beforeEach`.
    hookTimeout: 30000,
  },
})

import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { defaultScenario } from '../src/simulation/schema'

async function ready(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('./')
  expect(
    await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
  ).toBe(true)
  await expect(page.getByRole('button', { name: 'Play replay', exact: true })).toBeEnabled({
    timeout: 20000,
  })
}

async function range(page: Page, label: string, value: number) {
  await page.getByRole('slider', { name: label, exact: true }).evaluate((element, next) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      element,
      String(next),
    )
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

test('loads a real worker result and replays the fault and recovery', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await ready(page)
  await expect(page.getByRole('heading', { name: 'The retry storm', exact: true })).toBeVisible()
  await expect(page.locator('.service-node')).toHaveCount(6)
  await expect(page.locator('.react-flow__minimap-node')).toHaveCount(6)
  await range(page, 'Replay position', 25)
  await expect(page.getByTestId('service-database')).toHaveClass(/degraded/)
  await expect(page.locator('.replay-clock')).toContainText('00:25')
  await range(page, 'Replay position', 90)
  await expect(page.getByTestId('service-database')).toHaveClass(/healthy/)
  await expect(page.locator('.run-status')).toContainText('Replay complete')
  expect(errors).toEqual([])
})

test('plays, pauses, and seeks by a single second', async ({ page }) => {
  await ready(page)
  await page.getByRole('button', { name: 'Play replay', exact: true }).click()
  await expect
    .poll(() => page.getByRole('slider', { name: 'Replay position' }).inputValue())
    .not.toBe('0')
  await page.getByRole('button', { name: 'Pause replay', exact: true }).click()
  await page.getByRole('button', { name: 'Reset replay', exact: true }).click()
  await page.getByRole('button', { name: 'Next second', exact: true }).click()
  await expect(page.getByRole('slider', { name: 'Replay position' })).toHaveValue('1')
  await page.getByRole('button', { name: 'Previous second', exact: true }).click()
  await expect(page.getByRole('slider', { name: 'Replay position' })).toHaveValue('0')
})

test('compares outcomes and applies the comparison configuration', async ({ page }) => {
  await ready(page)
  await page.getByRole('button', { name: 'Compare', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Full experiment results' })).toBeVisible()
  await expect(page.locator('.comparison-results tbody tr')).toHaveCount(8)
  const brief = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export brief', exact: true }).click()
  expect((await brief).suggestedFilename()).toBe('cascade-incident-brief.md')
  await page.getByRole('button', { name: 'Apply comparison' }).click()
  await expect(page.getByRole('switch', { name: 'Circuit breaker' })).toBeChecked()
  await expect(page.getByRole('switch', { name: 'Jittered backoff' })).toBeChecked()
  await expect(page.getByRole('button', { name: 'Play replay', exact: true })).toBeEnabled()
})

test('edits capacity, adds a service, and rejects a dependency cycle', async ({ page }) => {
  await ready(page)
  await page.getByTestId('service-database').click()
  await page.getByRole('button', { name: 'Add replica', exact: true }).click()
  await expect(page.getByLabel('Replica count')).toHaveText('2')
  await page.getByRole('combobox', { name: 'New dependency' }).selectOption('gateway')
  await page.getByRole('button', { name: 'Connect dependency' }).click()
  await expect(page.locator('.notice-region')).toContainText('Circular dependencies')
  await expect(page.getByRole('button', { name: 'Play replay', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Add service', exact: true }).click()
  await expect(page.locator('.service-node')).toHaveCount(7)
  await expect(page.locator('.react-flow__minimap-node')).toHaveCount(7)
  await page.getByRole('button', { name: 'Remove service', exact: true }).click()
  await expect(page.locator('.service-node')).toHaveCount(6)
})

test('injects and clears a fault at the replay cursor', async ({ page }) => {
  await ready(page)
  await range(page, 'Replay position', 10)
  await page.getByRole('button', { name: 'Inject failure' }).click()
  await expect(page.locator('.timeline-caption')).toContainText('00:11 to 00:36')
  await expect(page.getByRole('button', { name: 'Pause replay', exact: true })).toBeEnabled()
  await range(page, 'Replay position', 18)
  await expect(page.getByTestId('service-database')).toHaveClass(/degraded/)
  await page.getByRole('button', { name: 'Clear faults' }).click()
  await expect(page.locator('.timeline-caption')).toContainText('No faults scheduled')
  await expect(page.getByRole('button', { name: 'Play replay', exact: true })).toBeEnabled()
  await expect(page.getByTestId('service-database')).toHaveClass(/healthy/)
})

test('saves locally, exports JSON, and restores after a reload', async ({ page }) => {
  await ready(page)
  await range(page, 'Arrival rate', 120)
  await page.getByRole('button', { name: 'Save experiment', exact: true }).click()
  await expect(page.locator('.notice-region')).toContainText('saved in this browser')
  const exported = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export experiment', exact: true }).click()
  expect((await exported).suggestedFilename()).toBe('cascade-experiment.json')
  await page.reload()
  await expect(page.getByRole('slider', { name: 'Arrival rate', exact: true })).toHaveValue('120')
})

test('imports a scenario and round-trips a share link without clipboard permission', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', { value: undefined }),
  )
  await ready(page)
  await page.getByLabel('Experiment JSON file').setInputFiles({
    name: 'experiment.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ ...defaultScenario, seed: 718, name: 'Shared resilience test' }),
    ),
  })
  await expect(page.getByRole('heading', { name: 'Shared resilience test' })).toBeVisible()
  await page.getByRole('link', { name: 'Skip to experiment' }).focus()
  await page.getByRole('link', { name: 'Skip to experiment' }).press('Enter')
  await expect(page.getByRole('heading', { name: 'Shared resilience test' })).toBeVisible()
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const url = await page.getByLabel('Reproducible link').inputValue()
  expect(url).toContain('#experiment=')
  await page.goto(url)
  await expect(page.getByRole('heading', { name: 'Shared resilience test' })).toBeVisible()
  await expect(page.locator('.experiment-meta')).toContainText('seed 718')
  await expect(page.getByRole('button', { name: 'Play replay', exact: true })).toBeEnabled()
})

test('recovers from malformed imports and broken shared URLs', async ({ page }) => {
  await ready(page)
  await page.getByLabel('Experiment JSON file').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{broken'),
  })
  await expect(page.locator('.notice-region')).toContainText('valid JSON')
  await page.goto('./#experiment=garbage')
  await expect(page.getByRole('heading', { name: 'The retry storm', exact: true })).toBeVisible()
  await expect(page.locator('.notice-region')).toContainText('default experiment')
})

test('switches experiments and supports both themes without horizontal overflow', async ({
  page,
}) => {
  await ready(page)
  await page
    .getByRole('combobox', { name: 'Experiment', exact: true })
    .selectOption('traffic-surge')
  await expect(page.getByRole('heading', { name: 'Flash crowd', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Use dark theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Use light theme' }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  for (const width of [393, 320, 1440]) {
    await page.setViewportSize({ width, height: 852 })
    await expect
      .poll(() =>
        page.evaluate(() => {
          const canvas = document.querySelector('.topology-canvas')!.getBoundingClientRect()
          return [...document.querySelectorAll('.service-node')].every((element) => {
            const node = element.getBoundingClientRect()
            return (
              node.left >= canvas.left - 1 &&
              node.right <= canvas.right + 1 &&
              node.top >= canvas.top - 1 &&
              node.bottom <= canvas.bottom + 1
            )
          })
        }),
      )
      .toBe(true)
    await expect
      .poll(() =>
        page.evaluate(() => {
          const handleElement = document.querySelector(
            '.react-flow__node[data-id="gateway"] .source',
          )!
          const handle = handleElement.getBoundingClientRect()
          const portrait = handleElement.getAttribute('data-handlepos') === 'bottom'
          const edge = document.querySelector<SVGPathElement>(
            '.react-flow__edge[data-id="gateway-checkout"] path',
          )!
          const start = edge.getPointAtLength(0)
          const point = new DOMPoint(start.x, start.y).matrixTransform(edge.getScreenCTM()!)
          return Math.hypot(
            point.x - (portrait ? handle.left + handle.width / 2 : handle.right),
            point.y - (portrait ? handle.bottom : handle.top + handle.height / 2),
          )
        }),
      )
      .toBeLessThan(2)
  }
})

test('passes automated accessibility checks in the lab and comparison', async ({ page }) => {
  await ready(page)
  await range(page, 'Replay position', 25)
  await page.getByText('Telemetry table', { exact: true }).click()
  const lab = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(lab.violations).toEqual([])
  await page.getByRole('button', { name: 'Compare', exact: true }).click()
  const comparison = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(comparison.violations).toEqual([])
})

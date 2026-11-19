type DemoMode = 'desktop' | 'phone'
const asked = typeof document === 'undefined' ? undefined : document.documentElement.dataset.demo
export const demo: DemoMode | null = asked === 'phone' || asked === 'desktop' ? asked : null
export const demoRun = () => import('./run')

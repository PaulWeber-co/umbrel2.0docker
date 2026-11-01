import {renderToStaticMarkup} from 'react-dom/server'
import {expect, test, vi} from 'vitest'

import {UpdatingCover} from './update'

const state = vi.hoisted(() => ({
	status: {
		containerManaged: true,
		jobId: 'test',
		targetVersion: '2.0.1',
		outcome: 'rolled-back',
		progress: 85,
		running: false,
		error: 'Previous version restored',
	},
}))
vi.mock('react-i18next', () => ({
	useTranslation: () => ({t: (key: string, values?: {name?: string}) => key + (values?.name ? ' ' + values.name : '')}),
}))
vi.mock('@/trpc/trpc', () => ({
	trpcReact: {
		system: {
			checkUpdate: {useQuery: () => ({data: undefined})},
			updateStatus: {useQuery: () => ({data: state.status, isLoading: false})},
			acknowledgeContainerUpdate: {useMutation: () => ({mutate: vi.fn(), isPending: false})},
		},
	},
}))
vi.mock('@/layouts/bare/bare-page', () => ({
	BarePage: ({children}: {children: React.ReactNode}) => <main>{children}</main>,
}))
vi.mock('@/modules/bare/failed-layout', () => ({
	default: ({description}: {description: React.ReactNode}) => <section>{description}</section>,
}))
vi.mock('@/modules/bare/progress-layout', () => ({
	ProgressLayout: ({title}: {title: string}) => <section>{title}</section>,
}))
vi.mock('@/components/ui/button', () => ({
	Button: ({children, ...props}: React.ComponentProps<'button'>) => <button {...props}>{children}</button>,
}))

test('shows persisted failure even if release lookup is temporarily unavailable', () => {
	state.status.outcome = 'rolled-back'
	state.status.error = 'Previous version restored'
	const html = renderToStaticMarkup(<UpdatingCover onRetry={() => {}} />)
	expect(html).toContain('Previous version restored')
	expect(html).toContain('software-update.continue-previous')
})
test('uses the durable target name while the container is reconnecting', () => {
	state.status.outcome = ''
	state.status.error = ''
	state.status.running = true
	const html = renderToStaticMarkup(<UpdatingCover onRetry={() => {}} />)
	expect(html).toContain('umbrelOS 2.0.1')
})
test('does not offer to continue after failed rollback', () => {
	state.status.outcome = 'failed'
	state.status.progress = 85
	state.status.error = 'Manual recovery required'
	const html = renderToStaticMarkup(<UpdatingCover onRetry={() => {}} />)
	expect(html).toContain('Manual recovery required')
	expect(html).not.toContain('software-update.continue-previous')
})

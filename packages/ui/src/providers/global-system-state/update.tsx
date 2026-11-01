import {useTranslation} from 'react-i18next'

import {Button} from '@/components/ui/button'
import {BarePage} from '@/layouts/bare/bare-page'
import FailedLayout from '@/modules/bare/failed-layout'
import {ProgressLayout} from '@/modules/bare/progress-layout'
import {trpcReact} from '@/trpc/trpc'

export function useUpdate({onMutate, onSuccess}: {onMutate?: () => void; onSuccess?: (didWork: boolean) => void}) {
	const updateVersionMut = trpcReact.system.update.useMutation({
		onMutate,
		onSuccess,
	})

	const update = () => updateVersionMut.mutate()

	return update
}

export function UpdatingCover({onRetry}: {onRetry: () => void}) {
	const {t} = useTranslation()
	const acknowledge = trpcReact.system.acknowledgeContainerUpdate.useMutation({
		onSuccess: () => {
			location.href = '/'
		},
	})
	const latestVersionQ = trpcReact.system.checkUpdate.useQuery()
	const updateStatusQ = trpcReact.system.updateStatus.useQuery(undefined, {
		refetchInterval: 500,
	})
	const latestVersion = latestVersionQ.data

	const targetName =
		latestVersion?.name ||
		(updateStatusQ.data?.targetVersion ? `umbrelOS ${updateStatusQ.data.targetVersion}` : 'umbrelOS')

	const {progress, description, running, error} = updateStatusQ.data ?? {}
	const indeterminate = updateStatusQ.isLoading || !running
	const safeToContinue = updateStatusQ.data?.containerManaged && updateStatusQ.data.safeToContinue === true

	return (
		<BarePage>
			{!error && (
				<ProgressLayout
					title={t('software-update.updating-to', {name: targetName})}
					callout={t('software-update.callout')}
					progress={indeterminate ? undefined : progress}
					message={description}
					isRunning={!!running}
				/>
			)}
			{error && (
				<>
					<FailedLayout
						title={t('software-update.failed')}
						description={<>Error: {error}</>}
						buttonText={t('software-update.failed.retry')}
						buttonOnClick={onRetry}
					/>
					{safeToContinue && (
						<Button disabled={acknowledge.isPending} onClick={() => acknowledge.mutate()}>
							{t('software-update.continue-previous')}
						</Button>
					)}
				</>
			)}
		</BarePage>
	)
}

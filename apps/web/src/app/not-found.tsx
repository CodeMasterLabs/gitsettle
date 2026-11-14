import Link from 'next/link';
import { EmptyState } from '@/components/ui';
export default function NotFound() { return <EmptyState title="This page is not in the queue." description="The link may be out of date. Return to the work queue to find an active bounty." action={<Link className="button button-primary" href="/">Open work queue</Link>} />; }

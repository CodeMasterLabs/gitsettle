'use client';
import { DataError } from '@/components/ui';
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) { return <DataError error="An unexpected error interrupted this page. Try loading it again." retry={reset} />; }

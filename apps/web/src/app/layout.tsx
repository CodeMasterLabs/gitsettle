import type { Metadata } from 'next';
import '@fontsource/source-sans-3/400.css';
import '@fontsource/source-sans-3/500.css';
import '@fontsource/source-sans-3/600.css';
import '@fontsource/source-sans-3/700.css';
import '@fontsource/newsreader/400.css';
import '@near-wallet-selector/modal-ui/styles.css';
import './globals.css';
import { WalletProvider } from '@/components/wallet-provider';
import { Shell } from '@/components/shell';

export const metadata: Metadata = {
  title: { default: 'GitSettle — Open work. Settled rewards.', template: '%s | GitSettle' },
  description: 'Self-hosted bug bounty, translation, and open source contribution escrow on NEAR Testnet.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: "try{document.documentElement.dataset.theme=localStorage.getItem('gitsettle.theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch(e){}" }} /></head><body><WalletProvider><Shell>{children}</Shell></WalletProvider></body></html>;
}

import type { Metadata, Viewport } from 'next';
import '@fontsource/source-sans-3/400.css';
import '@fontsource/source-sans-3/600.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import './globals.css';
import { WalletProvider } from '@/components/wallet-provider';
import { Shell } from '@/components/shell';
import { CommunityProvider } from '@/components/community-provider';

export const viewport: Viewport = { themeColor: '#080808' };

export const metadata: Metadata = {
  title: { default: 'GitSettle — Open work. Settled rewards.', template: '%s | GitSettle' },
  description: 'Self-hosted bug bounty, translation, and open source contribution escrow on NEAR Testnet.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: "try{document.documentElement.dataset.theme=localStorage.getItem('gitsettle.theme')||'dark'}catch(e){}" }} /></head><body><WalletProvider><CommunityProvider><Shell>{children}</Shell></CommunityProvider></WalletProvider></body></html>;
}

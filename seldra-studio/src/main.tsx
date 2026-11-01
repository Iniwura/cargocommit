import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from './config';
import { installShareSync } from './lib/share';
import { App } from './App';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 3000, refetchOnWindowFocus: true } },
});

installShareSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);

import { CreateOrderPage } from './components/CreateOrderPage';
import { Header } from './components/Header';
import { OrderPage } from './components/OrderPage';
import { OrdersPage } from './components/OrdersPage';
import { NETWORK, explorerAddress } from './config';
import { usePath } from './router';

export function App() {
  const path = usePath();
  const orderMatch = /^\/order\/([^/]+)\/?$/.exec(path);

  return (
    <div className="shell">
      {!NETWORK.isTestnet ? (
        <div className="mainnet-banner" role="alert">
          Arc Mainnet: every transaction moves real USDC and cannot be undone. This software has not been independently audited.
        </div>
      ) : null}
      <Header path={path} />
      {orderMatch ? <OrderPage order={decodeURIComponent(orderMatch[1])} /> : path === '/new' ? <CreateOrderPage /> : <OrdersPage />}
      <footer className="site-footer">
        <span>
          Seldra on {NETWORK.label}. Experimental, unaudited. Arc Studio implementation; the original CargoCommit deployment is separate and untouched.
        </span>
        {NETWORK.factory ? (
          <a className="mono" href={explorerAddress(NETWORK.factory)} target="_blank" rel="noopener noreferrer">
            Factory {NETWORK.factory.slice(0, 8)}…{NETWORK.factory.slice(-4)} ↗
          </a>
        ) : null}
      </footer>
    </div>
  );
}

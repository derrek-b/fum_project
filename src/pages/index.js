import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useSelector } from 'react-redux';
import Head from 'next/head';

export default function Home() {
  const router = useRouter();
  const { isConnected } = useSelector((state) => state.wallet);

  useEffect(() => {
    const redirectTimer = setTimeout(() => {
      // Redirect to vaults if wallet connected, otherwise to demo
      router.push(isConnected ? '/vaults' : '/demo');
    }, 1000);

    // Clean up the timeout if component unmounts
    return () => clearTimeout(redirectTimer);
  }, [router, isConnected]);

  return (
    <div>
      <Head>
        <title>D-fied | DeFi Liquidity Management</title>
        <meta name="description" content="DeFi liquidity position management platform" />
      </Head>
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        flexDirection: 'column'
      }}>
        <img
          src="/Logo.svg"
          alt="D-fied Logo"
          width="100"
          height="100"
          className="mb-4"
        />
        <h2>D-fied</h2>
        <p>{isConnected ? 'Loading Vaults Dashboard...' : 'Loading Demo...'}</p>
      </div>
    </div>
  );
}

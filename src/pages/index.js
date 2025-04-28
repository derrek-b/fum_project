import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const redirectTimer = setTimeout(() => {
      router.push('/vaults');
    }, 1000); // Wait 2 seconds before redirecting

    // Clean up the timeout if component unmounts
    return () => clearTimeout(redirectTimer);
  }, [router]);

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
        <p>Redirecting to Vaults Dashboard...</p>
      </div>
    </div>
  );
}

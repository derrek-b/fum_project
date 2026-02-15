import Head from 'next/head';
import Link from 'next/link';

export default function Home() {
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
          width="200"
          height="200"
          style={{ marginBottom: '1rem' }}
        />
        <h1 style={{ fontSize: '3.5rem', marginBottom: '0.5rem' }}>D-fied</h1>
        <p style={{ color: '#666', marginBottom: '3rem', fontSize: '1.1rem' }}>DeFi Liquidity Management</p>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', fontSize: '1.625rem', fontWeight: 600 }}>
          <Link href="/vaults" style={{ color: 'var(--crimson-700)', textDecoration: 'none' }}>
            Vaults
          </Link>
          <span style={{ color: 'var(--neutral-700)' }}>|</span>
          <Link href="/positions" style={{ color: 'var(--crimson-700)', textDecoration: 'none' }}>
            Positions
          </Link>
          <span style={{ color: 'var(--neutral-700)' }}>|</span>
          <Link href="/demo" style={{ color: 'var(--blue-accent)', textDecoration: 'none' }}>
            Demo
          </Link>
        </div>
      </div>
    </div>
  );
}

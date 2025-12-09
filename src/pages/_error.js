import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';

function ErrorPage({ statusCode }) {
  const router = useRouter();

  const is404 = statusCode === 404;
  const title = is404 ? 'Page Not Found' : 'Something Went Wrong';
  const message = is404
    ? "The page you're looking for doesn't exist or has been moved."
    : 'An unexpected error occurred. Please try again.';

  const handleRetry = () => {
    router.reload();
  };

  return (
    <div>
      <Head>
        <title>{`${title} | D-fied`}</title>
      </Head>
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        flexDirection: 'column',
        textAlign: 'center',
        padding: '2rem'
      }}>
        <img
          src="/Logo.svg"
          alt="D-fied Logo"
          width="120"
          height="120"
          style={{ marginBottom: '1.5rem', opacity: 0.8 }}
        />

        <h1 style={{
          fontSize: '5rem',
          fontWeight: 'bold',
          color: 'var(--crimson-700)',
          marginBottom: '0.5rem',
          lineHeight: 1
        }}>
          {statusCode || 'Error'}
        </h1>

        <h2 style={{
          fontSize: '1.5rem',
          marginBottom: '1rem',
          color: 'var(--neutral-800)'
        }}>
          {title}
        </h2>

        <p style={{
          color: 'var(--neutral-600)',
          marginBottom: '2rem',
          maxWidth: '400px'
        }}>
          {message}
        </p>

        <div style={{ display: 'flex', gap: '1rem' }}>
          {!is404 && (
            <button
              onClick={handleRetry}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: 'var(--crimson-700)',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '1rem',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Try Again
            </button>
          )}
          <Link
            href="/"
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: is404 ? 'var(--crimson-700)' : 'transparent',
              color: is404 ? '#fff' : 'var(--crimson-700)',
              border: is404 ? 'none' : '2px solid var(--crimson-700)',
              borderRadius: '6px',
              fontSize: '1rem',
              fontWeight: 600,
              textDecoration: 'none'
            }}
          >
            Go Home
          </Link>
        </div>
      </div>
    </div>
  );
}

ErrorPage.getInitialProps = ({ res, err }) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  return { statusCode };
};

export default ErrorPage;

import { Alert } from "react-bootstrap";

export default function BetaBanner() {
  return (
    <Alert variant="warning" className="mb-0 rounded-0 text-center py-2">
      <strong>Beta</strong> — Smart contracts are unaudited and may be redeployed during beta, which would disconnect existing vaults from this frontend. Use at your own risk.
    </Alert>
  );
}

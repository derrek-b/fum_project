import React from "react";
import { Navbar as BSNavbar, Nav } from "react-bootstrap";
import WalletConnectEVM from "./WalletConnectEVM";

export default function Navbar() {
  return (
    <BSNavbar bg="dark" variant="dark" expand="lg" className="mb-4">
      <BSNavbar.Brand href="/">
        <img
          src="/Logo.svg"
          alt="D-fied Logo"
          width="30"
          height="30"
          className="d-inline-block align-top"
        />{" "}
        -fied
      </BSNavbar.Brand>
      <Nav className="ms-auto">
        <WalletConnectEVM />
      </Nav>
    </BSNavbar>
  );
}

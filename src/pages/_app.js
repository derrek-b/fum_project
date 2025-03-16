import { Provider } from "react-redux";
import { store } from "../redux/store";
import "bootstrap/dist/css/bootstrap.min.css";
import "../styles/globals.css";
import { ProviderProvider } from "../context/ProviderContext";

export default function MyApp({ Component, pageProps }) {
  return (
    <Provider store={store}>
      <Component {...pageProps} />
    </Provider>
  );
}

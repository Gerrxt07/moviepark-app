import LegalContent from "../components/LegalContent";
import {AppHeader,AppNav} from "../components/AppChrome";
export default function Page(){return <div className="app-shell"><AppHeader backHref="/" title="Rechtliches"/><main><LegalContent/></main><AppNav active="more"/></div>}

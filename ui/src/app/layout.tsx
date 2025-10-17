import './globals.css';
import Link from 'next/link';
import Sidebar from '../components/Sidebar';
import Topbar from '../components/Topbar';
import RouteSpinner from '../components/RouteSpinner';
import AuthRedirect from '../components/AuthRedirect';

export const metadata = {
  title: 'Sparrow',
  description: 'Sparrow – preprocess and persona test UI',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Topbar />
        <div className="mainwrap">
          <Sidebar />
          <main className="content">
            <div className="container">{children}</div>
            <div id="overlay-root"></div>
            <RouteSpinner />
            <AuthRedirect />
          </main>
        </div>
      </body>
    </html>
  );
}

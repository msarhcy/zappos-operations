import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSession } from "@/lib/session";
import { Wordmark } from "@/components/brand/wordmark";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { session, loading } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    navigate({ to: session ? "/dashboard" : "/auth", replace: true });
  }, [session, loading, navigate]);

  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <Wordmark size="lg" showTagline />
    </div>
  );
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-lg font-bold text-white">I</span>
          <p className="mt-2 text-lg font-semibold">InventoryOS</p>
        </div>
        {children}
      </div>
    </main>
  );
}

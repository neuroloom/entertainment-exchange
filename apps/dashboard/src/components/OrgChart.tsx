import type { Agent } from '../lib/api';

interface OrgNode {
  id: string;
  label: string;
  role: string;
  status: string;
  children: OrgNode[];
  budgetDailyCents?: number;
  autonomyLevel?: number;
}

function OrgNodeCard({ node, depth = 0 }: { node: OrgNode; depth?: number }) {
  const isAgent = node.autonomyLevel !== undefined;
  return (
    <div className="flex flex-col items-center">
      <div className={`px-4 py-3 rounded-xl border-2 text-center min-w-[160px] ${
        node.status === 'active' ? 'border-indigo-300 bg-white shadow-sm' : 'border-gray-200 bg-gray-50 opacity-60'
      }`}>
        <div className="font-semibold text-sm">{node.label}</div>
        <div className="text-xs text-slate-500">{node.role}</div>
        {isAgent && (
          <div className="mt-1 flex gap-2 justify-center text-xs">
            <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">L{node.autonomyLevel}</span>
            {node.budgetDailyCents != null && (
              <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full">${(node.budgetDailyCents / 100).toFixed(0)}/d</span>
            )}
          </div>
        )}
        <div className={`mt-1 inline-block px-2 py-0.5 rounded text-xs ${
          node.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
        }`}>{node.status}</div>
      </div>
      {node.children.length > 0 && (
        <>
          <div className="w-px h-4 bg-slate-300" />
          <div className="flex gap-8">
            {node.children.map(child => (
              <OrgNodeCard key={child.id} node={child} depth={depth + 1} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function OrgChart({ agents, businessName }: { agents: Agent[]; businessName: string }) {
  const root: OrgNode = {
    id: 'root',
    label: businessName,
    role: 'Agency',
    status: 'active',
    children: agents.map(a => ({
      id: a.id,
      label: a.name,
      role: a.role,
      status: a.status,
      autonomyLevel: a.autonomyLevel,
      budgetDailyCents: a.budgetDailyCents,
      children: [],
    })),
  };

  return (
    <div className="overflow-auto p-8">
      <div className="min-w-max flex justify-center">
        <OrgNodeCard node={root} />
      </div>
    </div>
  );
}

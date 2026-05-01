import React from 'react';

const Table = ({ columns, data }) => {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr>
            {columns.map((col, idx) => (
              <th key={idx} className="p-3 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-white/10">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rowIdx) => (
            <tr key={rowIdx} className="hover:bg-white/[0.02] transition-colors">
              {row.map((cell, cellIdx) => (
                <td key={cellIdx} className={`p-4 border-b border-white/[0.04] whitespace-nowrap ${cellIdx === 0 ? "font-medium text-gray-200" : "text-gray-400 text-sm"}`}>
                  {cell.content}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default Table;

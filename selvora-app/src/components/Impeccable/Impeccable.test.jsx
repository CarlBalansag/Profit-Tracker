import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Section } from './Section';
import { Row } from './Row';
import { StatRow } from './StatRow';
import { Tabs } from './Tabs';

afterEach(() => cleanup());

describe('Impeccable primitives', () => {
  it('Section renders a title/action header and its children', () => {
    render(
      <Section title="Pipeline" action={<button>Add</button>}>
        <div>child content</div>
      </Section>
    );
    expect(screen.getByText('Pipeline')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(screen.getByText('child content')).toBeInTheDocument();
  });

  it('Section renders with no header when title/action are omitted', () => {
    render(<Section><div>bare content</div></Section>);
    expect(screen.getByText('bare content')).toBeInTheDocument();
  });

  it('Row renders label, sublabel, and value, and fires onClick when interactive', () => {
    const onClick = vi.fn();
    render(<Row label="Widget" sublabel="12 units" value="$42.00" onClick={onClick} />);
    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByText('12 units')).toBeInTheDocument();
    expect(screen.getByText('$42.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('Row renders as a non-interactive div when no onClick is given', () => {
    render(<Row label="Static row" value="10" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Static row')).toBeInTheDocument();
  });

  it('StatRow renders one entry per item with label and value', () => {
    render(
      <StatRow
        items={[
          { id: 'profit', label: 'Profit', value: '$1,204' },
          { id: 'roi', label: 'ROI', value: '18%' },
        ]}
      />
    );
    expect(screen.getByText('Profit')).toBeInTheDocument();
    expect(screen.getByText('$1,204')).toBeInTheDocument();
    expect(screen.getByText('ROI')).toBeInTheDocument();
    expect(screen.getByText('18%')).toBeInTheDocument();
  });

  it('Tabs renders every tab and calls onChange with the clicked id', () => {
    const onChange = vi.fn();
    render(
      <Tabs
        tabs={[{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }]}
        active="one"
        onChange={onChange}
      />
    );
    expect(screen.getByRole('button', { name: 'One' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Two' }));
    expect(onChange).toHaveBeenCalledWith('two');
  });
});

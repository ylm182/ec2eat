// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EntrySwipe } from "../components/EntrySwipe";
vi.mock("react-tinder-card", () => ({ default: ({ children, onSwipe, preventSwipe }: { children: React.ReactNode; onSwipe: (d:string)=>void; preventSwipe:string[] }) => <div data-testid="swipe" data-prevent={preventSwipe.join(",")} onClick={() => onSwipe("up")}>{children}</div> }));
afterEach(cleanup);
it.each([['附近 · 1 公里','left'], ['遠一點 · 2 公里','up'], ['周圍搵 · 5 公里','right']])("range control %s chooses %s", (label,direction) => {
 const choose=vi.fn(); render(<EntrySwipe kind="range" onChoose={choose}/>);
 fireEvent.click(screen.getByRole('button',{name:new RegExp(label)})); expect(choose).toHaveBeenCalledWith(direction);
});
it('allows an upward range swipe and blocks it when disabled',()=>{
 const choose=vi.fn(); const view=render(<EntrySwipe kind="range" onChoose={choose}/>);
 expect(screen.getByTestId('swipe').getAttribute('data-prevent')).toBe('down');
 fireEvent.click(screen.getByTestId('swipe')); expect(choose).toHaveBeenCalledWith('up');
 view.rerender(<EntrySwipe kind="range" disabled onChoose={choose}/>);
 fireEvent.click(screen.getByTestId('swipe')); expect(choose).toHaveBeenCalledTimes(1);
});

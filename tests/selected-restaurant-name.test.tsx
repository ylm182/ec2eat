// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SelectedRestaurantName } from "../components/SelectedRestaurantName";
import { syntheticPlaces } from "../lib/server/places";
const api=vi.hoisted(()=>vi.fn());
vi.mock('../lib/client/decision-api',()=>({authorizedJson:api}));
afterEach(cleanup);
it('shows fetched selected restaurant name instead of its ID',async()=>{
 const card=await syntheticPlaces('results').details('synthetic-0',new AbortController().signal);
 api.mockResolvedValue({cards:[{...card,name:'測試茶餐廳'}]});
 render(<SelectedRestaurantName uid="alice" sessionId="session-1" placeId={card.placeId}/>);
 expect(await screen.findByText('當時揀咗：測試茶餐廳')).toBeTruthy();
 expect(screen.queryByText(card.placeId,{exact:false})).toBeNull();
});
it('keeps visit confirmation usable with a readable fallback on failure',async()=>{
 api.mockRejectedValue(new Error('unavailable'));
 render(<SelectedRestaurantName uid="alice" sessionId="session-1" placeId="private-id"/>);
 expect(await screen.findByText(/名稱暫時未能讀取/)).toBeTruthy();
 expect(screen.queryByText(/private-id/)).toBeNull();
});

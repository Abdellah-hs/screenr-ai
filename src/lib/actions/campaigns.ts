"use server";

import { redirect } from "next/navigation";
import {
  MOCK_CAMPAIGNS,
  getCampaignByIdFromMock,
  getActiveCampaignsFromMock,
  type Campaign,
} from "@/lib/constants";

export async function createCampaign(formData: FormData) {
  const title = formData.get("title") as string;
  const description = formData.get("description") as string;
  const department = (formData.get("department") as string) || null;
  const positions = parseInt(formData.get("positions") as string) || 1;
  const status = (formData.get("status") as string) || "draft";
  const deadline = (formData.get("deadline") as string) || null;
  const location = (formData.get("location") as string) || null;

  // Mock: just log and redirect to list (no persistence yet)
  console.log("[mock] createCampaign:", { title, description, department, positions, status, deadline, location });
  redirect("/campaigns");
}

export async function getCampaigns(): Promise<Campaign[]> {
  return getActiveCampaignsFromMock();
}

export async function getCampaignById(id: string): Promise<Campaign | null> {
  return getCampaignByIdFromMock(id) ?? null;
}

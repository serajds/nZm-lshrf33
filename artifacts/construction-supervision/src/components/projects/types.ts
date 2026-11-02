import type { Project } from "@workspace/api-client-react";
import type { PortfolioRelation } from "@/lib/project-portfolio";

/** Temporary local extension until the generated client is regenerated. */
export type PortfolioProject = Project & {
  parentProjectId?: number | null;
  categoryId?: number | null;
  categoryName?: string | null;
  portfolioRelation?: PortfolioRelation | null;
  canManage?: boolean | null;
  ownerCompanyId?: number | null;
  contractorCompanyId?: number | null;
  supervisorCompanyId?: number | null;
  onedriveTestResultsFolderId?: string | null;
};

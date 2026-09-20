                                                          

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { DocumentParserModule } from '../../document-parser/document-parser.module';
import { KnowledgeChunkerService } from './knowledge-chunker.service';
import { KnowledgeEmbeddingService } from './knowledge-embedding.service';
import { KnowledgeIngestionService } from './knowledge-ingestion.service';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';
import { KnowledgeSearchTool } from './tools/knowledge-search.tool';

@Module({
  imports: [PrismaModule, DocumentParserModule],
  providers: [
    KnowledgeChunkerService,
    KnowledgeEmbeddingService,
    KnowledgeIngestionService,
    KnowledgeRetrievalService,
    KnowledgeSearchTool,
  ],
  exports: [
    KnowledgeIngestionService,
    KnowledgeRetrievalService,
    KnowledgeSearchTool,
  ],
})
export class KnowledgeModule {}

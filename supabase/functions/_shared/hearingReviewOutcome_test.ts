import { strict as assert } from 'node:assert';
import { exclusivelyHearingReview, hearingReviewNote } from './hearingReviewOutcome.ts';
import { remediationVerdict } from './ateniaRemediationSecurity.ts';

Deno.test('a durable hearing-document review never certifies the batch or hides another error', () => {
  const item={reason:'HEARING_SUSPENSION_TARGET_UNVERIFIED' as const,source_act_id:'fixture'};
  const ref=hearingReviewNote(item);
  assert.equal(exclusivelyHearingReview([ref],[item]),true);
  assert.equal(exclusivelyHearingReview([ref,'DB_TIMEOUT'],[item]),false);
  assert.equal(exclusivelyHearingReview([],[]),false);
  const body={ok:false,partial:true,source_complete:true,code:'POST_INGEST_EFFECTS_PENDING',errors:[ref],
    hearing_document_review:{count:1,references:[item],only_unresolved_effect:true}};
  assert.deepEqual(remediationVerdict(body,'RETRY_ACTS'),{outcome:'SKIPPED',code:'HEARING_DOCUMENT_REVIEW_REQUIRED'});
  for (const other of [{...body,source_complete:false},{...body,scraping_initiated:true},{...body,pending_upstream:true},
      {...body,hearing_document_review:null},{...body,hearing_document_review:{...body.hearing_document_review,only_unresolved_effect:false}}])
    assert.equal(remediationVerdict(other,'RETRY_ACTS').outcome,'RETRY');
  assert.equal(remediationVerdict(body,'RETRY_PUBS').outcome,'RETRY');
});

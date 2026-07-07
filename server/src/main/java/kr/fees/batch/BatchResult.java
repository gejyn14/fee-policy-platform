package kr.fees.batch;

/** 배치 산출 결과 집계. */
public record BatchResult(int inserted, int updated, int deleted, int unchanged) {

    public static BatchResult zero() {
        return new BatchResult(0, 0, 0, 0);
    }

    public BatchResult plus(BatchResult o) {
        return new BatchResult(inserted + o.inserted, updated + o.updated, deleted + o.deleted, unchanged + o.unchanged);
    }
}

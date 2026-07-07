package kr.fees.api;

import kr.fees.batch.BatchResult;
import kr.fees.batch.BindingRebuilder;
import kr.fees.batch.DeltaBatch;
import kr.fees.persistence.BatchRunRepository;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;

/** 배정판 배치 트리거·이력. */
@RestController
@RequestMapping("/api/batch")
public class BatchController {

    private final BindingRebuilder rebuilder;
    private final DeltaBatch deltaBatch;
    private final BatchRunRepository batchRuns;

    public BatchController(BindingRebuilder rebuilder, DeltaBatch deltaBatch, BatchRunRepository batchRuns) {
        this.rebuilder = rebuilder;
        this.deltaBatch = deltaBatch;
        this.batchRuns = batchRuns;
    }

    @PostMapping("/rebuild")
    public BatchResult rebuild(@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate baseDate) {
        return rebuilder.fullRebuild(baseDate != null ? baseDate : LocalDate.now());
    }

    @PostMapping("/delta")
    public BatchResult delta(@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate baseDate) {
        return deltaBatch.run(baseDate != null ? baseDate : LocalDate.now());
    }

    @GetMapping("/runs")
    public List<BatchRunRepository.Run> runs() {
        return batchRuns.findRecent();
    }
}

package kr.fees.api;

import kr.fees.batch.BatchResult;
import kr.fees.batch.IncrementalBinder;
import kr.fees.persistence.EnrollmentRepository;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;

/** 신청형 이벤트 가입. */
@RestController
@RequestMapping("/api/enrollments")
public class EnrollController {

    private final EnrollmentRepository enrollments;
    private final IncrementalBinder binder;

    public EnrollController(EnrollmentRepository enrollments, IncrementalBinder binder) {
        this.enrollments = enrollments;
        this.binder = binder;
    }

    public record EnrollRequest(String accountId, String ruleId, String channel) {}

    @PostMapping
    public BatchResult enroll(@RequestBody EnrollRequest req,
                              @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate baseDate) {
        LocalDate d = baseDate != null ? baseDate : LocalDate.now();
        enrollments.insertActiveEvent(req.accountId(), req.ruleId(), d, req.channel());
        return binder.onEnrollment(req.accountId(), d);
    }
}
